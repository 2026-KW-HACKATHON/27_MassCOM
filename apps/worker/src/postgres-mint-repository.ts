import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MintEventMismatchError,
  RetryableChainError,
  type ChainMintResult,
  type MintWorkItem,
  type MintWorkRepository,
  type UnconfirmedSignedTransaction,
} from './mint-worker.js';
import { buildNftMetadata, parseNftMetadataOrigin } from './nft-metadata.js';

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
  /**
   * Bounds how long withMinterLock waits to acquire the per chain/minter advisory lock, on the
   * dedicated connection that holds it. A wedged holder (or a very large backlog of callers) must
   * not be able to block this connection, and therefore this worker, forever.
   */
  minterLockTimeoutMs: number;
  /** 공개 메타데이터·그림의 출처(Issue #254). 기본값 없이 반드시 받는다(실행기는 NFT_METADATA_ORIGIN). */
  nftMetadataOrigin: string;
};

type MetadataFactsRow = {
  asset_id: string;
  token_id: string;
  nft_series_id: string;
  merchant_id: string;
  merchant_name: string;
  neighborhood: string | null;
  category: string | null;
  campaign_title: string;
  target_visit_count: number;
  store_public: boolean;
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

type UnconfirmedSignedRow = {
  transaction_hash: string;
  signed_transaction: string;
  reward_key: string;
  recipient_address: string;
  chain_id: number;
  contract_address: string;
  series_key: string;
};

const defaultOptions: Omit<Options, 'nftMetadataOrigin'> = {
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
  minterLockTimeoutMs: 10_000,
};

const unconfirmedSweepLimit = 50;

export class PostgresMintRepository implements MintWorkRepository {
  private readonly options: Options;

  constructor(
    private readonly pool: Pool,
    options: Partial<Omit<Options, 'nftMetadataOrigin'>> & Pick<Options, 'nftMetadataOrigin'>,
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
    if (
      !Number.isSafeInteger(this.options.minterLockTimeoutMs) ||
      this.options.minterLockTimeoutMs <= 0
    ) {
      throw new Error('minterLockTimeoutMs must be a positive safe integer');
    }
    this.options.nftMetadataOrigin = parseNftMetadataOrigin(this.options.nftMetadataOrigin);
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
  ): Promise<UnconfirmedSignedTransaction[]> {
    const result = await this.pool.query<UnconfirmedSignedRow>(
      `SELECT attempt.transaction_hash, attempt.signed_transaction,
              encode(job.reward_key, 'hex') AS reward_key,
              job.recipient_address, job.chain_id, job.contract_address,
              encode(job.series_key, 'hex') AS series_key
       FROM mint_tx_attempts AS attempt
       JOIN mint_jobs AS job ON job.id = attempt.mint_job_id
       WHERE job.chain_id = $1
         AND attempt.status = 'SUBMITTED'
         AND attempt.signed_transaction IS NOT NULL
         AND job.status NOT IN ('FINALIZED', 'MANUAL_REVIEW', 'CANCELLED')
       ORDER BY attempt.submitted_at, attempt.attempt_number
       LIMIT ${unconfirmedSweepLimit + 1}`,
      [chainId],
    );
    // A partial view would compute a nonce floor from some of the in-flight nonces only, so an
    // over-full window is reported instead of silently truncated.
    if (result.rows.length > unconfirmedSweepLimit) {
      throw new RetryableChainError('MINTER_UNCONFIRMED_BACKLOG');
    }
    return result.rows.map((row) => ({
      transactionHash: row.transaction_hash,
      signedTransaction: row.signed_transaction,
      intent: {
        rewardKey: `0x${row.reward_key}`,
        recipient: row.recipient_address,
        chainId: row.chain_id,
        contractAddress: row.contract_address,
        seriesKey: `0x${row.series_key}`,
      },
    }));
  }

  async withMinterLock<T>(
    chainId: number,
    minterAddress: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const [key1, key2] = advisoryLockKey(chainId, minterAddress);
    const client = await this.pool.connect();
    // Destroyed instead of pooled if anything below leaves the session in a state we cannot
    // trust: an advisory lock is held per-session, so a connection returned to the pool while
    // still holding it (or while we are not sure it does not) would silently wedge every future
    // borrower of that connection behind a lock nothing will ever release.
    let destroy = false;
    try {
      // Bound the acquisition itself, on this dedicated connection only, so a wedged holder (or a
      // pile-up of callers) cannot block this connection forever. Session-scoped via set_config
      // (no surrounding transaction here), so it is reset explicitly once the lock is held.
      await client.query("SELECT set_config('lock_timeout', $1, false)", [
        `${this.options.minterLockTimeoutMs}ms`,
      ]);
      let held = false;
      try {
        await client.query('SELECT pg_advisory_lock($1, $2)', [key1, key2]);
        held = true;
      } catch (error) {
        if (isLockTimeout(error)) {
          throw new RetryableChainError('MINTER_LOCK_TIMEOUT', { cause: error });
        }
        throw error;
      } finally {
        try {
          await client.query("SELECT set_config('lock_timeout', '0', false)");
        } catch (error) {
          // The session kept a non-default lock_timeout and may hold the lock without reaching the
          // unlock below: never pool it. Without the lock the acquisition error already in flight
          // (e.g. MINTER_LOCK_TIMEOUT) is the one the caller must see, so this one is not rethrown.
          destroy = true;
          if (held) throw error;
        }
      }
      try {
        return await fn();
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [key1, key2]);
        } catch (error) {
          // The lock may still be held on this session: never let it go back to the pool.
          destroy = true;
          throw error;
        }
      }
    } finally {
      client.release(destroy);
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
        // 재확정은 이미 있는 스냅샷을 바꾸지 않는다(없을 때만 만든다).
        await snapshotTokenMetadata(client, item.jobId, this.options.nftMetadataOrigin);
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
      // 발행 확정과 같은 트랜잭션에서 공개 메타데이터를 고정한다(Issue #254). 실패하면 확정도 되돌아가 다음 실행이 다시 한다.
      await snapshotTokenMetadata(client, item.jobId, this.options.nftMetadataOrigin);
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
    // 체인 발행은 끝났고 메타데이터 스냅샷만 실패했다(Issue #254). 기다림이 끝나 수동 검토로 닫을 때도 원인 코드를 남기고, 채굴된
    // 거래의 시도 기록은 실패로 닫지 않는다. 운영자가 원인을 고친 뒤 RETRYABLE로 되돌리면 findMintByRewardKey가 확정한다.
    const mintedOnChain = code === 'NFT_METADATA_SNAPSHOT_FAILED';
    const closeForReview = (fallbackCode: string) => closeForManualReview(
      client, jobId, mintedOnChain ? code : fallbackCode, now, { keepSubmittedAttempts: mintedOnChain },
    );

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
        await closeForReview('RECEIPT_ATTEMPT_MISSING');
        return;
      }
      if (now.getTime() - attempt.submitted_at.getTime() >= this.options.receiptTimeoutMs) {
        await closeForReview('RECEIPT_TIMEOUT');
        return;
      }
    } else if (job.attempt_count >= this.options.maxAttempts) {
      // Only submission attempts count, so waiting for finality or an RPC outage never lands here.
      await closeForReview('RETRY_LIMIT_EXCEEDED');
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
  options: { keepSubmittedAttempts?: boolean } = {},
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
  // even though nothing can ever act on its job again. Exception: a job whose mint is already on
  // chain (only the metadata snapshot failed) keeps its mined attempt SUBMITTED; the sweep ignores
  // MANUAL_REVIEW jobs, and finalize closes it as MINED once an operator re-queues the job.
  if (!options.keepSubmittedAttempts) {
    await client.query(
      `UPDATE mint_tx_attempts
       SET status = 'FAILED', error_code = $1, updated_at = $2
       WHERE mint_job_id = $3 AND status = 'SUBMITTED'`,
      [code, now, jobId],
    );
  }
  await client.query(
    `UPDATE outbox_events
     SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE aggregate_id = $2`,
    [now, jobId],
  );
}

// 토큰 메타데이터 스냅샷(Issue #254, D-060). 이미 있으면 아무것도 읽거나 쓰지 않으므로 재확정이 내용을 바꾸지 않는다.
// 가게 그림은 이 트랜잭션에서 읽은 바이트를 그대로 복사해 두므로 뒤에 가게가 그림을 바꾸거나 되돌려도 남는다.
// 어떤 실패든 NFT_METADATA_SNAPSHOT_FAILED로 감싸 확정 전체를 되돌리고 작업을 재시도 대기(last_error_code)로 둔다.
async function snapshotTokenMetadata(client: PoolClient, jobId: string, origin: string): Promise<void> {
  try {
    const saved = await client.query(
      `SELECT 1 FROM nft_token_metadata AS saved
       JOIN nft_assets AS asset ON asset.id = saved.nft_asset_id
       WHERE asset.mint_job_id = $1`,
      [jobId],
    );
    if (saved.rowCount) return;
    const facts = await client.query<MetadataFactsRow>(
      `SELECT asset.id AS asset_id, asset.token_id::text AS token_id, job.nft_series_id,
              merchant.id AS merchant_id, merchant.name AS merchant_name, merchant.neighborhood, merchant.category,
              (merchant.status = 'ACTIVE' AND (merchant.is_demo OR merchant.consent_document_ref IS NOT NULL))
                AS store_public,
              campaign.title AS campaign_title, series.target_visit_count
       FROM nft_assets AS asset
       JOIN mint_jobs AS job ON job.id = asset.mint_job_id
       JOIN nft_series AS series ON series.id = job.nft_series_id
       JOIN campaigns AS campaign ON campaign.id = series.campaign_id
       JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
       WHERE asset.mint_job_id = $1`,
      [jobId],
    );
    const row = facts.rows[0];
    if (!row) throw new Error('NFT_METADATA_FACTS_MISSING');
    let artImage: Buffer | null = null;
    if (row.store_public) {
      const art = (await client.query<{ image: Buffer }>(
        'SELECT image FROM merchant_art WHERE merchant_id = $1',
        [row.merchant_id],
      )).rows[0]?.image ?? null;
      // 운영자가 내린 그림(거부 목록)은 복사하지 않고 기본 도장을 쓴다.
      if (art && art.length > 0) {
        const takenDown = await client.query(
          'SELECT 1 FROM nft_metadata_takedowns WHERE target = $1',
          [`image:${createHash('sha256').update(art).digest('hex')}`],
        );
        if (!takenDown.rowCount) artImage = art;
      }
    }
    const snapshot = buildNftMetadata({
      storePublic: row.store_public,
      merchantName: row.merchant_name,
      neighborhood: row.neighborhood,
      category: row.category,
      campaignTitle: row.campaign_title,
      targetVisitCount: row.target_visit_count,
      artImage,
    }, origin);
    if (snapshot.image) {
      await client.query(
        `INSERT INTO nft_metadata_images (sha256, image) VALUES ($1, $2)
         ON CONFLICT (sha256) DO NOTHING`,
        [snapshot.image.sha256, snapshot.image.bytes],
      );
    }
    await client.query(
      `INSERT INTO nft_token_metadata (nft_asset_id, nft_series_id, token_id, metadata_json, image_sha256)
       VALUES ($1, $2, $3::numeric, $4, $5)
       ON CONFLICT (nft_asset_id) DO NOTHING`,
      [row.asset_id, row.nft_series_id, row.token_id, snapshot.json, snapshot.image?.sha256 ?? null],
    );
  } catch (error) {
    // 원인은 한 번만 남긴다: 작업 id(내부 uuid), PostgreSQL SQLSTATE·제약 이름, 대문자 코드 모양의 오류 이름뿐이다.
    // 값이나 자유 문장 메시지는 남기지 않는다.
    const detail = error as { code?: unknown; constraint?: unknown; message?: unknown };
    console.error(JSON.stringify({
      event: 'NFT_METADATA_SNAPSHOT_FAILED',
      jobId,
      sqlstate: typeof detail.code === 'string' ? detail.code : null,
      constraint: typeof detail.constraint === 'string' ? detail.constraint : null,
      reason: typeof detail.message === 'string' && /^[A-Z][A-Z0-9_]+$/.test(detail.message) ? detail.message : null,
    }));
    throw new RetryableChainError('NFT_METADATA_SNAPSHOT_FAILED', { cause: error });
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
    ...(row.signed_transaction ? { signedTransaction: row.signed_transaction } : {}),
  };
}

/** PostgreSQL's lock_timeout SQLSTATE (55P03, lock_not_available). */
function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '55P03'
  );
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
