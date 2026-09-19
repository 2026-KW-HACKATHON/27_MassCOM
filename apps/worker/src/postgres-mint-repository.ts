import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MintEventMismatchError,
  type ChainMintResult,
  type MintWorkItem,
  type MintWorkRepository,
} from './mint-worker.js';

type Options = {
  now: () => Date;
  nextAttemptId: () => string;
  nextChainEventId: () => string;
  nextAssetId: () => string;
  retryDelayMs: number;
};

type WorkRow = {
  job_id: string;
  outbox_id: string;
  account_id: string;
  entitlement_id: string;
  reward_key: string;
  recipient_address: string;
  chain_id: number;
  contract_address: string;
  series_key: string;
  transaction_hash: string | null;
};

type ExistingAssetRow = {
  transaction_hash: string;
  block_number: string;
  block_hash: string;
  log_index: number;
  token_id: string;
  reward_key: string;
  recipient_address: string;
  series_key: string;
  contract_address: string;
  chain_id: number;
};

const defaultOptions: Options = {
  now: () => new Date(),
  nextAttemptId: () => randomUUID(),
  nextChainEventId: () => randomUUID(),
  nextAssetId: () => randomUUID(),
  retryDelayMs: 1_000,
};

export class PostgresMintRepository implements MintWorkRepository {
  private readonly options: Options;

  constructor(
    private readonly pool: Pool,
    options: Partial<Options> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
  }

  async leaseNext(workerId: string, leaseMs: number): Promise<MintWorkItem | undefined> {
    const now = this.options.now();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query<WorkRow>(
          `SELECT
             job.id AS job_id,
             outbox.id AS outbox_id,
             job.account_id,
             job.entitlement_id,
             encode(job.reward_key, 'hex') AS reward_key,
             job.recipient_address,
             job.chain_id,
             job.contract_address,
             encode(job.series_key, 'hex') AS series_key,
             job.transaction_hash
           FROM outbox_events AS outbox
           JOIN mint_jobs AS job ON job.id = outbox.aggregate_id
           WHERE outbox.event_type = 'MINT_REQUESTED'
             AND (
               (outbox.status = 'PENDING' AND outbox.available_at <= $1)
               OR (outbox.status = 'LEASED' AND outbox.lease_expires_at <= $1)
             )
             AND job.status NOT IN ('FINALIZED', 'PAUSED', 'MANUAL_REVIEW')
           ORDER BY outbox.available_at, outbox.created_at, outbox.id
           FOR UPDATE OF outbox, job SKIP LOCKED
           LIMIT 1`,
          [now],
        )
      ).rows[0];
      if (!row) {
        await client.query('COMMIT');
        return undefined;
      }
      await client.query(
        `UPDATE outbox_events
         SET status = 'LEASED', lease_owner = $1, lease_expires_at = $2, updated_at = $3
         WHERE id = $4`,
        [workerId, leaseExpiresAt, now, row.outbox_id],
      );
      await client.query('COMMIT');
      return mapWork(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markPrepared(item: MintWorkItem, workerId: string): Promise<string> {
    const now = this.options.now();
    const attemptId = this.options.nextAttemptId();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = (
        await client.query<{ attempt_count: number }>(
          `UPDATE mint_jobs AS job
           SET status = 'PREPARED',
               attempt_count = attempt_count + 1,
               last_error_code = NULL,
               updated_at = $1
           WHERE job.id = $2
             AND job.status IN ('QUEUED', 'RETRYABLE', 'PREPARED')
             AND EXISTS (
               SELECT 1 FROM outbox_events AS outbox
               WHERE outbox.id = $3
                 AND outbox.aggregate_id = job.id
                 AND outbox.status = 'LEASED'
                 AND outbox.lease_owner = $4
                 AND outbox.lease_expires_at > $1
             )
           RETURNING attempt_count`,
          [now, item.jobId, item.outboxId, workerId],
        )
      ).rows[0];
      if (!updated) throw new Error('MINT_JOB_LEASE_LOST');
      await client.query(
        `INSERT INTO mint_tx_attempts (
           id, mint_job_id, attempt_number, status, prepared_at, updated_at
         ) VALUES ($1, $2, $3, 'PREPARED', $4, $4)`,
        [attemptId, item.jobId, updated.attempt_count, now],
      );
      await client.query('COMMIT');
      return attemptId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markSubmitted(
    jobId: string,
    workerId: string,
    attemptId: string,
    transactionHash: string,
  ): Promise<void> {
    const now = this.options.now();
    const normalizedHash = transactionHash.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await client.query(
        `UPDATE mint_tx_attempts
         SET status = 'SUBMITTED', transaction_hash = $1, submitted_at = $2, updated_at = $2
         WHERE id = $3 AND mint_job_id = $4`,
        [normalizedHash, now, attemptId, jobId],
      );
      await client.query(
        `UPDATE mint_jobs
         SET status = 'SUBMITTED', transaction_hash = $1, updated_at = $2
         WHERE id = $3`,
        [normalizedHash, now, jobId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async finalize(
    item: MintWorkItem,
    workerId: string,
    attemptId: string | undefined,
    result: ChainMintResult,
  ): Promise<void> {
    assertResultMatches(item, result);
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await findExistingAsset(client, item.jobId);
      if (existing) {
        assertStoredResultMatches(existing, result);
        await client.query('COMMIT');
        return;
      }
      await requireLease(client, item.jobId, workerId, now);

      const chainEventId = this.options.nextChainEventId();
      await client.query(
        `INSERT INTO chain_events (
           id, chain_id, contract_address_normalized, transaction_hash, log_index,
           block_number, block_hash, reward_key, series_key,
           recipient_address_normalized, token_id, status, observed_at, finalized_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, decode(substr($8, 3), 'hex'),
           decode(substr($9, 3), 'hex'), $10, $11::numeric, 'FINALIZED', $12, $12
         )`,
        [
          chainEventId,
          result.chainId,
          result.contractAddress.toLowerCase(),
          result.transactionHash.toLowerCase(),
          result.logIndex,
          result.blockNumber,
          result.blockHash.toLowerCase(),
          result.rewardKey,
          result.seriesKey,
          result.recipient.toLowerCase(),
          result.tokenId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO nft_assets (
           id, mint_job_id, chain_event_id, chain_id, contract_address,
           contract_address_normalized, token_id, reward_key, recipient_address,
           recipient_address_normalized, finalized_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7::numeric,
           decode(substr($8, 3), 'hex'), $9, $10, $11
         )`,
        [
          this.options.nextAssetId(),
          item.jobId,
          chainEventId,
          result.chainId,
          result.contractAddress,
          result.contractAddress.toLowerCase(),
          result.tokenId,
          result.rewardKey,
          result.recipient,
          result.recipient.toLowerCase(),
          now,
        ],
      );
      if (attemptId) {
        await client.query(
          `UPDATE mint_tx_attempts
           SET status = 'MINED', transaction_hash = $1, mined_at = $2, updated_at = $2
           WHERE id = $3 AND mint_job_id = $4`,
          [result.transactionHash.toLowerCase(), now, attemptId, item.jobId],
        );
      }
      await client.query(
        `UPDATE mint_jobs
         SET status = 'FINALIZED', transaction_hash = $1, token_id = $2::numeric,
             last_error_code = NULL, finalized_at = $3, updated_at = $3
         WHERE id = $4`,
        [result.transactionHash.toLowerCase(), result.tokenId, now, item.jobId],
      );
      await client.query(
        `UPDATE reward_entitlements AS entitlement
         SET status = 'FULFILLED', updated_at = $1
         FROM mint_jobs AS job
         WHERE job.id = $2 AND entitlement.id = job.entitlement_id`,
        [now, item.jobId],
      );
      await client.query(
        `UPDATE outbox_events
         SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
         WHERE id = $2`,
        [now, item.outboxId],
      );
      await client.query(
        `INSERT INTO chain_cursors (chain_id, contract_address_normalized, next_block, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (chain_id, contract_address_normalized)
         DO UPDATE SET
           next_block = greatest(chain_cursors.next_block, excluded.next_block),
           updated_at = excluded.updated_at`,
        [result.chainId, result.contractAddress.toLowerCase(), result.blockNumber + 1, now],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseRetryable(jobId: string, workerId: string, code: string): Promise<void> {
    const now = this.options.now();
    const availableAt = new Date(now.getTime() + this.options.retryDelayMs);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await client.query(
        `UPDATE mint_jobs
         SET status = 'RETRYABLE', last_error_code = $1, updated_at = $2
         WHERE id = $3`,
        [code, now, jobId],
      );
      await client.query(
        `UPDATE outbox_events
         SET status = 'PENDING', available_at = $1, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = $2
         WHERE aggregate_id = $3`,
        [availableAt, now, jobId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markManualReview(jobId: string, workerId: string, code: string): Promise<void> {
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await client.query(
        `UPDATE mint_jobs
         SET status = 'MANUAL_REVIEW', last_error_code = $1, updated_at = $2
         WHERE id = $3`,
        [code, now, jobId],
      );
      await client.query(
        `UPDATE outbox_events
         SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
         WHERE aggregate_id = $2`,
        [now, jobId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function requireLease(
  client: PoolClient,
  jobId: string,
  workerId: string,
  now: Date,
): Promise<void> {
  const result = await client.query(
    `SELECT 1
     FROM outbox_events
     WHERE aggregate_id = $1
       AND status = 'LEASED'
       AND lease_owner = $2
       AND lease_expires_at > $3
     FOR UPDATE`,
    [jobId, workerId, now],
  );
  if (result.rowCount !== 1) throw new Error('MINT_JOB_LEASE_LOST');
}

async function findExistingAsset(
  client: PoolClient,
  jobId: string,
): Promise<ExistingAssetRow | undefined> {
  return (
    await client.query<ExistingAssetRow>(
      `SELECT
         event.transaction_hash,
         event.block_number::text,
         event.block_hash,
         event.log_index,
         asset.token_id::text,
         encode(asset.reward_key, 'hex') AS reward_key,
         asset.recipient_address,
         encode(event.series_key, 'hex') AS series_key,
         asset.contract_address,
         asset.chain_id
       FROM nft_assets AS asset
       JOIN chain_events AS event ON event.id = asset.chain_event_id
       WHERE asset.mint_job_id = $1`,
      [jobId],
    )
  ).rows[0];
}

function mapWork(row: WorkRow): MintWorkItem {
  return {
    jobId: row.job_id,
    outboxId: row.outbox_id,
    accountId: row.account_id,
    entitlementId: row.entitlement_id,
    rewardKey: `0x${row.reward_key}`,
    recipient: row.recipient_address,
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    seriesKey: `0x${row.series_key}`,
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
  };
}

function assertResultMatches(item: MintWorkItem, result: ChainMintResult): void {
  const matches =
    result.chainId === item.chainId &&
    result.contractAddress.toLowerCase() === item.contractAddress.toLowerCase() &&
    result.rewardKey.toLowerCase() === item.rewardKey.toLowerCase() &&
    result.recipient.toLowerCase() === item.recipient.toLowerCase() &&
    result.seriesKey.toLowerCase() === item.seriesKey.toLowerCase();
  if (!matches) throw new MintEventMismatchError('MINT_EVENT_MISMATCH');
}

function assertStoredResultMatches(row: ExistingAssetRow, result: ChainMintResult): void {
  const matches =
    row.transaction_hash === result.transactionHash.toLowerCase() &&
    row.block_number === String(result.blockNumber) &&
    row.block_hash === result.blockHash.toLowerCase() &&
    row.log_index === result.logIndex &&
    row.token_id === result.tokenId &&
    `0x${row.reward_key}` === result.rewardKey.toLowerCase() &&
    row.recipient_address.toLowerCase() === result.recipient.toLowerCase() &&
    `0x${row.series_key}` === result.seriesKey.toLowerCase() &&
    row.contract_address.toLowerCase() === result.contractAddress.toLowerCase() &&
    row.chain_id === result.chainId;
  if (!matches) throw new MintEventMismatchError('STORED_MINT_EVENT_MISMATCH');
}
