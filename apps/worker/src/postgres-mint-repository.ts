import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MintEventMismatchError,
  RetryableChainError,
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
  maxRetryDelayMs: number;
  maxAttempts: number;
  /**
   * Wall-clock bound on checking the result of an already-broadcast transaction (the job holds a
   * transaction_hash), measured from that attempt's submitted_at. Separate from maxAttempts, which
   * only caps new sends: a receipt check never sends a transaction, so it must not be able to
   * exhaust the send cap and stop a job that is simply waiting on confirmations.
   */
  receiptTimeoutMs: number;
  chainFromBlock: number;
  reorgMargin: number;
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
  signed_transaction: string | null;
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
  maxRetryDelayMs: 300_000,
  maxAttempts: 5,
  receiptTimeoutMs: 24 * 60 * 60 * 1_000,
  chainFromBlock: 0,
  reorgMargin: 12,
};

export class PostgresMintRepository implements MintWorkRepository {
  private readonly options: Options;

  constructor(
    private readonly pool: Pool,
    options: Partial<Options> = {},
  ) {
    this.options = { ...defaultOptions, ...options };
    if (!Number.isSafeInteger(this.options.maxAttempts) || this.options.maxAttempts <= 0) {
      throw new Error('maxAttempts must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.options.receiptTimeoutMs) || this.options.receiptTimeoutMs <= 0) {
      throw new Error('receiptTimeoutMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.options.chainFromBlock) || this.options.chainFromBlock < 0) {
      throw new Error('chainFromBlock must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(this.options.reorgMargin) || this.options.reorgMargin <= 0) {
      throw new Error('reorgMargin must be a positive safe integer');
    }
  }

  async getEventScanStart(chainId: number, contractAddress: string): Promise<number> {
    let row: { scan_from_block: string } | undefined;
    try {
      row = (
        await this.pool.query<{ scan_from_block: string }>(
          `SELECT greatest($3::bigint, next_block - $4::bigint)::text AS scan_from_block
           FROM chain_cursors
           WHERE chain_id = $1 AND contract_address_normalized = $2`,
          [
            chainId,
            contractAddress.toLowerCase(),
            this.options.chainFromBlock,
            this.options.reorgMargin,
          ],
        )
      ).rows[0];
    } catch (error) {
      // Fail closed: an unreadable cursor must never look like "nothing minted yet".
      throw new RetryableChainError('CHAIN_CURSOR_READ_FAILED', { cause: error });
    }
    if (!row) return this.options.chainFromBlock;
    const scanFromBlock = Number(row.scan_from_block);
    if (!Number.isSafeInteger(scanFromBlock) || scanFromBlock < 0) {
      throw new Error('chain cursor exceeds the supported block range');
    }
    return scanFromBlock;
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
             job.transaction_hash,
             attempt.signed_transaction
           FROM outbox_events AS outbox
           JOIN mint_jobs AS job ON job.id = outbox.aggregate_id
           LEFT JOIN mint_tx_attempts AS attempt
             ON attempt.mint_job_id = job.id
             AND attempt.transaction_hash = job.transaction_hash
             AND attempt.status = 'SUBMITTED'
           WHERE outbox.event_type = 'MINT_REQUESTED'
             AND (
               (outbox.status = 'PENDING' AND outbox.available_at <= $1)
               OR (outbox.status = 'LEASED' AND outbox.lease_expires_at <= $1)
             )
             AND job.status NOT IN ('FINALIZED', 'PAUSED', 'MANUAL_REVIEW', 'CANCELLED')
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

  async renewLease(item: MintWorkItem, workerId: string, leaseMs: number): Promise<void> {
    const now = this.options.now();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const updated = await this.pool.query(
      `UPDATE outbox_events
       SET lease_expires_at = $1, updated_at = $2
       WHERE id = $3
         AND aggregate_id = $4
         AND status = 'LEASED'
         AND lease_owner = $5
         AND lease_expires_at > $2`,
      [leaseExpiresAt, now, item.outboxId, item.jobId, workerId],
    );
    if (updated.rowCount === 1) return;

    const current = (
      await this.pool.query<{
        status: string;
        lease_owner: string | null;
        job_status: string;
      }>(
        `SELECT outbox.status, outbox.lease_owner, job.status AS job_status
         FROM outbox_events AS outbox
         JOIN mint_jobs AS job ON job.id = outbox.aggregate_id
         WHERE outbox.id = $1 AND outbox.aggregate_id = $2`,
        [item.outboxId, item.jobId],
      )
    ).rows[0];
    if (
      current &&
      current.status !== 'LEASED' &&
      ['FINALIZED', 'RETRYABLE', 'MANUAL_REVIEW'].includes(current.job_status)
    ) {
      return;
    }
    throw new Error('MINT_JOB_LEASE_LOST');
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
    signedTransaction?: string,
  ): Promise<void> {
    const now = this.options.now();
    const normalizedHash = transactionHash.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await client.query(
        `UPDATE mint_tx_attempts
         SET status = 'SUBMITTED', transaction_hash = $1, signed_transaction = $5,
             submitted_at = $2, updated_at = $2
         WHERE id = $3 AND mint_job_id = $4`,
        [normalizedHash, now, attemptId, jobId, signedTransaction ?? null],
      );
      const updatedJob = await client.query(
        `UPDATE mint_jobs
         SET status = 'SUBMITTED', transaction_hash = $1, retry_streak = 0, updated_at = $2
         WHERE id = $3
           AND status = 'PREPARED'`,
        [normalizedHash, now, jobId],
      );
      if (updatedJob.rowCount !== 1) throw new Error('MINT_JOB_STATE_CONFLICT');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Serializes the nonce-read -> sign -> record -> broadcast sequence for one chain/minter pair
   * across every worker process using a PostgreSQL session advisory lock, so two submissions for
   * the same minter never race for the same nonce. The lock is acquired and released on the same
   * dedicated connection, since PostgreSQL session advisory locks are held per-session.
   */
  /**
   * Signed transactions that were recorded but have no result yet, oldest first. They still own
   * their nonces, so they must reach the network before a new nonce is read.
   * Only attempts whose parent job is still active are returned: a job already closed
   * (FINALIZED / MANUAL_REVIEW / CANCELLED) can leave a SUBMITTED attempt behind (e.g. an
   * un-broadcastable straggler sent to manual review), and that attempt must stop being swept
   * forever once its job is terminal. Bounded by a sane LIMIT so one chain can never make this
   * scan unbounded.
   * ponytail: filtered by chain only, one service minter per chain; add a minter column if a
   * chain ever gets a second minter.
   */
  async listUnconfirmedSignedTransactions(
    chainId: number,
  ): Promise<{ transactionHash: string; signedTransaction: string }[]> {
    const result = await this.pool.query<{ transaction_hash: string; signed_transaction: string }>(
      `SELECT attempt.transaction_hash, attempt.signed_transaction
       FROM mint_tx_attempts AS attempt
       JOIN mint_jobs AS job ON job.id = attempt.mint_job_id
       WHERE job.chain_id = $1
         AND attempt.status = 'SUBMITTED'
         AND attempt.signed_transaction IS NOT NULL
         AND job.status NOT IN ('FINALIZED', 'MANUAL_REVIEW', 'CANCELLED')
       ORDER BY attempt.submitted_at, attempt.attempt_number
       LIMIT 50`,
      [chainId],
    );
    return result.rows.map((row) => ({
      transactionHash: row.transaction_hash,
      signedTransaction: row.signed_transaction,
    }));
  }

  async withMinterLock<T>(
    chainId: number,
    minterAddress: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const [key1, key2] = advisoryLockKey(chainId, minterAddress);
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
      }
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
      } else {
        // Restart recovery has no attempt id; the hash is unique per attempt, so close that row.
        await client.query(
          `UPDATE mint_tx_attempts
           SET status = 'MINED', mined_at = $2, updated_at = $2
           WHERE mint_job_id = $3 AND transaction_hash = $1 AND status = 'SUBMITTED'`,
          [result.transactionHash.toLowerCase(), now, item.jobId],
        );
      }
      // Any other still-SUBMITTED attempt of this job (a straggler sharing the job but not the
      // hash that actually got mined) is now dead on arrival: the job only has one nonce future,
      // and it just landed under a different attempt. Close it so it stops being swept forever.
      await client.query(
        `UPDATE mint_tx_attempts
         SET status = 'FAILED', error_code = 'SUPERSEDED_BY_ONCHAIN_MINT', updated_at = $2
         WHERE mint_job_id = $3 AND status = 'SUBMITTED' AND transaction_hash IS DISTINCT FROM $1`,
        [result.transactionHash.toLowerCase(), now, item.jobId],
      );
      await client.query(
        `UPDATE mint_jobs
         SET status = 'FINALIZED', transaction_hash = $1, token_id = $2::numeric,
             last_error_code = NULL, retry_streak = 0, finalized_at = $3, updated_at = $3
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await this.releaseForRetry(client, jobId, code, now);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseRevertedForRetry(
    jobId: string,
    workerId: string,
    attemptId: string,
    revertCode: string,
    retryCode: string,
  ): Promise<void> {
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      // One transaction: a reverted hash left behind is re-confirmed forever, and a hash dropped
      // without the release leaves a SUBMITTED job that no step can prepare again.
      await client.query(
        `UPDATE mint_tx_attempts
         SET status = 'FAILED', error_code = $1, updated_at = $2
         WHERE id = $3 AND mint_job_id = $4 AND status = 'SUBMITTED'`,
        [revertCode, now, attemptId, jobId],
      );
      // Matched by the attempt's own hash, not by job status: after a restart the job is RETRYABLE,
      // and matching the hash also keeps a newer transaction from being dropped by mistake.
      const dropped = await client.query(
        `UPDATE mint_jobs
         SET transaction_hash = NULL, updated_at = $1
         WHERE id = $2
           AND transaction_hash = (SELECT transaction_hash FROM mint_tx_attempts WHERE id = $3)`,
        [now, jobId, attemptId],
      );
      if (dropped.rowCount !== 1) throw new Error('MINT_REVERTED_HASH_MISMATCH');
      await this.releaseForRetry(client, jobId, retryCode, now);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseForRetry(
    client: PoolClient,
    jobId: string,
    code: string,
    now: Date,
  ): Promise<void> {
    const job = (
      await client.query<{
        attempt_count: number;
        retry_streak: number;
        transaction_hash: string | null;
      }>(
        'SELECT attempt_count, retry_streak, transaction_hash FROM mint_jobs WHERE id = $1 FOR UPDATE',
        [jobId],
      )
    ).rows[0];
    if (!job) throw new Error('MINT_JOB_NOT_FOUND');

    if (job.transaction_hash) {
      // The job already holds a broadcast transaction: this release only checks its result
      // (RECEIPT_NOT_READY or a lookup failure), it never sends a new one, so the send cap below
      // does not apply. Bound it by wall-clock time since that attempt was submitted instead.
      const attempt = (
        await client.query<{ submitted_at: Date | null }>(
          `SELECT submitted_at FROM mint_tx_attempts
           WHERE mint_job_id = $1 AND transaction_hash = $2 AND status = 'SUBMITTED'
           ORDER BY attempt_number DESC
           LIMIT 1`,
          [jobId, job.transaction_hash],
        )
      ).rows[0];
      // Without the submitted attempt there is no clock to bound the wait, so stop here rather
      // than restarting the clock on every release.
      if (!attempt?.submitted_at) {
        await closeForManualReview(client, jobId, 'RECEIPT_ATTEMPT_MISSING', now);
        return;
      }
      if (now.getTime() - attempt.submitted_at.getTime() >= this.options.receiptTimeoutMs) {
        await closeForManualReview(client, jobId, 'RECEIPT_TIMEOUT', now);
        return;
      }
    } else if (job.attempt_count >= this.options.maxAttempts) {
      // Only submission attempts count, so waiting for finality or an RPC outage never lands here.
      await closeForManualReview(client, jobId, 'RETRY_LIMIT_EXCEEDED', now);
      return;
    }
    // The streak also grows on pre-submission failures (RPC outages, a paused contract) so a long
    // outage backs off instead of hammering the RPC/DB every base-delay tick, but it is never used
    // to decide the manual-review caps above.
    const delayMs = Math.min(
      this.options.retryDelayMs * 2 ** job.retry_streak,
      this.options.maxRetryDelayMs,
    );
    await client.query(
      `UPDATE mint_jobs
       SET status = 'RETRYABLE', last_error_code = $1, retry_streak = least(retry_streak + 1, 30), updated_at = $2
       WHERE id = $3`,
      [code, now, jobId],
    );
    await client.query(
      `UPDATE outbox_events
       SET status = 'PENDING', available_at = $1, lease_owner = NULL,
           lease_expires_at = NULL, updated_at = $2
       WHERE aggregate_id = $3`,
      [new Date(now.getTime() + delayMs), now, jobId],
    );
  }

  /** See MintWorkRepository.findAttemptIdForTransactionHash. */
  async findAttemptIdForTransactionHash(
    jobId: string,
    transactionHash: string,
  ): Promise<string | undefined> {
    const row = (
      await this.pool.query<{ id: string }>(
        `SELECT id FROM mint_tx_attempts
         WHERE mint_job_id = $1 AND transaction_hash = $2 AND status = 'SUBMITTED'
         ORDER BY attempt_number DESC
         LIMIT 1`,
        [jobId, transactionHash.toLowerCase()],
      )
    ).rows[0];
    return row?.id;
  }

  async markManualReview(jobId: string, workerId: string, code: string): Promise<void> {
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await requireLease(client, jobId, workerId, now);
      await closeForManualReview(client, jobId, code, now);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function closeForManualReview(
  client: PoolClient,
  jobId: string,
  code: string,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE mint_jobs
     SET status = 'MANUAL_REVIEW', last_error_code = $1, updated_at = $2
     WHERE id = $3`,
    [code, now, jobId],
  );
  // A job going to manual review can still be holding a SUBMITTED attempt (a straggler that
  // never got a receipt, or one this worker gave up on). Close it in the same transaction: left
  // SUBMITTED, it would be swept and rebroadcast forever by listUnconfirmedSignedTransactions
  // even though nothing can ever act on its job again.
  await client.query(
    `UPDATE mint_tx_attempts
     SET status = 'FAILED', error_code = $1, updated_at = $2
     WHERE mint_job_id = $3 AND status = 'SUBMITTED'`,
    [code, now, jobId],
  );
  await client.query(
    `UPDATE outbox_events
     SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE aggregate_id = $2`,
    [now, jobId],
  );
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
    ...(row.signed_transaction ? { signedTransaction: row.signed_transaction } : {}),
  };
}

/** Deterministic two-int32 key for pg_advisory_lock, scoped to one chain/minter pair. */
function advisoryLockKey(chainId: number, minterAddress: string): [number, number] {
  const digest = createHash('sha256')
    .update(`mint-minter-lock:${chainId}:${minterAddress.toLowerCase()}`)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
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
