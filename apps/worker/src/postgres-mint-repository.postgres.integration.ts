import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { PostgresMintRepository } from './postgres-mint-repository.js';
import {
  MintWorker,
  RetryableChainError,
  type ChainMintResult,
  type MintChainGateway,
} from './mint-worker.js';

const testMetadataOrigin = 'https://masscom.kr';

function expectedUnconfirmed(
  item: {
    rewardKey: string;
    recipient: string;
    chainId: number;
    contractAddress: string;
    seriesKey: string;
  },
  transactionHash: string,
  signedTransaction: string,
) {
  return {
    transactionHash,
    signedTransaction,
    intent: {
      rewardKey: item.rewardKey,
      recipient: item.recipient,
      chainId: item.chainId,
      contractAddress: item.contractAddress,
      seriesKey: item.seriesKey,
    },
  };
}

test('M03 M06 lease race, retry, finalization, and repeated event ingestion stay idempotent', async (t) => {
  const connectionString = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);

  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000001',
    nextChainEventId: () => '70000000-0000-4000-8000-000000000001',
    nextAssetId: () => '80000000-0000-4000-8000-000000000001',
  });

  const leaseRace = await Promise.all([
    repository.leaseNext('worker-a', 30_000),
    repository.leaseNext('worker-b', 30_000),
  ]);
  assert.equal(leaseRace.filter(Boolean).length, 1);
  const item = leaseRace.find(Boolean)!;
  assert.equal(item.jobId, '40000000-0000-4000-8000-000000000001');
  assert.equal(item.rewardKey, `0x${'11'.repeat(32)}`);
  assert.equal(item.seriesKey, `0x${'33'.repeat(32)}`);

  const workerId = leaseRace[0] ? 'worker-a' : 'worker-b';
  now = new Date('2026-09-19T04:00:20.000Z');
  await repository.renewLease(item, workerId, 30_000);
  const renewed = await pool.query<{ lease_expires_at: Date }>(
    `SELECT lease_expires_at
     FROM outbox_events
     WHERE id = $1`,
    [item.outboxId],
  );
  assert.equal(
    renewed.rows[0]?.lease_expires_at.toISOString(),
    '2026-09-19T04:00:50.000Z',
  );
  const attemptId = await repository.markPrepared(item, workerId);
  const transactionHash = `0x${'aa'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, workerId, attemptId, transactionHash);

  const result: ChainMintResult = {
    transactionHash,
    blockNumber: 4,
    blockHash: `0x${'bb'.repeat(32)}`,
    logIndex: 2,
    tokenId: '1',
    rewardKey: item.rewardKey,
    recipient: item.recipient,
    seriesKey: item.seriesKey,
    contractAddress: item.contractAddress,
    chainId: item.chainId,
  };
  await repository.finalize(item, workerId, attemptId, result);
  await repository.finalize(item, workerId, attemptId, result);

  const state = await pool.query<{
    job_status: string;
    entitlement_status: string;
    outbox_status: string;
    attempt_status: string;
    event_count: number;
    asset_count: number;
    token_id: string;
  }>(
    `SELECT
       (SELECT status FROM mint_jobs WHERE id = $1) AS job_status,
       (SELECT status FROM reward_entitlements WHERE id = '20000000-0000-4000-8000-000000000001') AS entitlement_status,
       (SELECT status FROM outbox_events WHERE aggregate_id = $1) AS outbox_status,
       (SELECT status FROM mint_tx_attempts WHERE id = $2) AS attempt_status,
       (SELECT count(*)::integer FROM chain_events) AS event_count,
       (SELECT count(*)::integer FROM nft_assets) AS asset_count,
       (SELECT token_id::text FROM nft_assets WHERE mint_job_id = $1) AS token_id`,
    [item.jobId, attemptId],
  );
  assert.deepEqual(state.rows[0], {
    job_status: 'FINALIZED',
    entitlement_status: 'FULFILLED',
    outbox_status: 'PUBLISHED',
    attempt_status: 'MINED',
    event_count: 1,
    asset_count: 1,
    token_id: '1',
  });

  await pool.query(
    `UPDATE mint_jobs
     SET status = 'RETRYABLE', last_error_code = 'RPC_TIMEOUT', updated_at = $1
     WHERE id = $2`,
    [now, item.jobId],
  );
  await pool.query(
    `UPDATE outbox_events
     SET status = 'LEASED', lease_owner = 'dead-worker', lease_expires_at = $1, updated_at = $1
     WHERE aggregate_id = $2`,
    [new Date(now.getTime() - 1), item.jobId],
  );
  await pool.query('TRUNCATE nft_assets, chain_events CASCADE');
  now = new Date('2026-09-19T04:01:00.000Z');

  const recoveredLease = await repository.leaseNext('worker-recovery', 30_000);
  assert.equal(recoveredLease?.jobId, item.jobId);
  await repository.finalize(recoveredLease!, 'worker-recovery', undefined, result);

  const restored = await pool.query<{ job_status: string; event_count: number; asset_count: number }>(
    `SELECT
       (SELECT status FROM mint_jobs WHERE id = $1) AS job_status,
       (SELECT count(*)::integer FROM chain_events) AS event_count,
       (SELECT count(*)::integer FROM nft_assets) AS asset_count`,
    [item.jobId],
  );
  assert.deepEqual(restored.rows[0], {
    job_status: 'FINALIZED',
    event_count: 1,
    asset_count: 1,
  });
});

test('lease renewal rejects an account-deletion cancellation instead of silently continuing', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const item = await repository.leaseNext('worker-delete-race', 30_000);
  assert.ok(item);
  await repository.markPrepared(item, 'worker-delete-race');
  await pool.query(
    `UPDATE mint_jobs SET status = 'CANCELLED' WHERE id = $1`,
    [item.jobId],
  );
  await pool.query(
    `UPDATE outbox_events
     SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL
     WHERE id = $1`,
    [item.outboxId],
  );

  await assert.rejects(
    repository.renewLease(item, 'worker-delete-race', 30_000),
    /MINT_JOB_LEASE_LOST/,
  );
});

test('lease renewal rejects an already expired lease', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
  });
  const item = await repository.leaseNext('worker-expired-lease', 30_000);
  assert.ok(item);

  now = new Date('2026-09-19T04:00:30.001Z');

  await assert.rejects(
    repository.renewLease(item, 'worker-expired-lease', 30_000),
    /MINT_JOB_LEASE_LOST/,
  );
});

test('markSubmitted cannot revive a cancelled prepared job', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000002',
  });
  const item = await repository.leaseNext('worker-cancelled-submit', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-cancelled-submit');
  await pool.query(`UPDATE mint_jobs SET status = 'CANCELLED' WHERE id = $1`, [item.jobId]);

  await assert.rejects(
    repository.markSubmitted(
      item.jobId,
      'worker-cancelled-submit',
      attemptId,
      `0x${'aa'.repeat(32)}`,
    ),
    /MINT_JOB_STATE_CONFLICT/,
  );

  const state = await pool.query<{ status: string }>(
    `SELECT status FROM mint_jobs WHERE id = $1`,
    [item.jobId],
  );
  assert.equal(state.rows[0]?.status, 'CANCELLED');
});

test('retry delay doubles per submission attempt and the attempt cap closes the job for manual review', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    retryDelayMs: 1_000,
    maxRetryDelayMs: 3_000,
    maxAttempts: 3,
  });
  const readState = async (jobId: string) =>
    (
      await pool.query<{ job_status: string; code: string; outbox_status: string; delay_ms: number }>(
        `SELECT job.status AS job_status, job.last_error_code AS code, outbox.status AS outbox_status,
                (extract(epoch FROM outbox.available_at - $2::timestamptz) * 1000)::integer AS delay_ms
         FROM mint_jobs AS job JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
         WHERE job.id = $1`,
        [jobId, now],
      )
    ).rows[0];

  // A failure before any submission does not consume an attempt and keeps the base delay.
  const first = await repository.leaseNext('worker-retry', 30_000);
  assert.ok(first);
  await repository.releaseRetryable(first.jobId, 'worker-retry', 'MINT_EVENT_LOOKUP_FAILED');
  assert.deepEqual(await readState(first.jobId), {
    job_status: 'RETRYABLE',
    code: 'MINT_EVENT_LOOKUP_FAILED',
    outbox_status: 'PENDING',
    delay_ms: 1_000,
  });

  for (const expectedDelayMs of [2_000, 3_000]) {
    now = new Date(now.getTime() + 60_000);
    const item = await repository.leaseNext('worker-retry', 30_000);
    assert.equal(item?.jobId, first.jobId);
    await repository.markPrepared(item!, 'worker-retry');
    await repository.releaseRetryable(first.jobId, 'worker-retry', 'RPC_TIMEOUT');
    assert.equal((await readState(first.jobId))?.delay_ms, expectedDelayMs);
  }

  now = new Date(now.getTime() + 60_000);
  const last = await repository.leaseNext('worker-retry', 30_000);
  assert.equal(last?.jobId, first.jobId);
  await repository.markPrepared(last!, 'worker-retry');
  await repository.releaseRetryable(first.jobId, 'worker-retry', 'RPC_TIMEOUT');
  const closed = await readState(first.jobId);
  assert.equal(closed?.job_status, 'MANUAL_REVIEW');
  assert.equal(closed?.code, 'RETRY_LIMIT_EXCEEDED');
  assert.equal(closed?.outbox_status, 'PUBLISHED');

  now = new Date(now.getTime() + 3_600_000);
  assert.equal(await repository.leaseNext('worker-retry', 30_000), undefined);
});

test('repeated pre-submission failures back off exponentially without consuming an attempt', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    retryDelayMs: 1_000,
    maxRetryDelayMs: 10_000,
    maxAttempts: 5,
  });
  const readState = async (jobId: string) =>
    (
      await pool.query<{ job_status: string; attempt_count: number; delay_ms: number }>(
        `SELECT job.status AS job_status, job.attempt_count,
                (extract(epoch FROM outbox.available_at - $2::timestamptz) * 1000)::integer AS delay_ms
         FROM mint_jobs AS job JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
         WHERE job.id = $1`,
        [jobId, now],
      )
    ).rows[0];

  const first = await repository.leaseNext('worker-outage-backoff', 30_000);
  assert.ok(first);

  // Only RPC/pause/balance failures before submission: attempt_count never moves, but the delay
  // still grows so a long outage stops hammering the RPC/DB every base-delay tick.
  for (const expectedDelayMs of [1_000, 2_000, 4_000, 8_000, 10_000, 10_000]) {
    now = new Date(now.getTime() + 60_000);
    const item = await repository.leaseNext('worker-outage-backoff', 30_000);
    assert.equal(item?.jobId, first.jobId);
    await repository.releaseRetryable(first.jobId, 'worker-outage-backoff', 'RPC_UNAVAILABLE');
    const state = await readState(first.jobId);
    assert.equal(state?.job_status, 'RETRYABLE');
    assert.equal(state?.attempt_count, 0);
    assert.equal(state?.delay_ms, expectedDelayMs);
  }
});

test('a successful submission or finalize resets the retry streak to the base delay', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000003',
    retryDelayMs: 1_000,
    maxRetryDelayMs: 60_000,
    maxAttempts: 5,
  });
  const readDelayMs = async (jobId: string) =>
    (
      await pool.query<{ delay_ms: number }>(
        `SELECT (extract(epoch FROM outbox.available_at - $2::timestamptz) * 1000)::integer AS delay_ms
         FROM outbox_events AS outbox
         WHERE outbox.aggregate_id = $1`,
        [jobId, now],
      )
    ).rows[0]?.delay_ms;

  const item = await repository.leaseNext('worker-streak-reset', 30_000);
  assert.ok(item);
  await repository.releaseRetryable(item.jobId, 'worker-streak-reset', 'RPC_UNAVAILABLE');
  now = new Date(now.getTime() + 60_000);
  const relet = await repository.leaseNext('worker-streak-reset', 30_000);
  assert.equal(relet?.jobId, item.jobId);
  await repository.releaseRetryable(item.jobId, 'worker-streak-reset', 'RPC_UNAVAILABLE');
  assert.equal(await readDelayMs(item.jobId), 2_000);

  // markSubmitted resets the streak.
  now = new Date(now.getTime() + 60_000);
  const leased = await repository.leaseNext('worker-streak-reset', 30_000);
  assert.equal(leased?.jobId, item.jobId);
  const attemptId = await repository.markPrepared(leased!, 'worker-streak-reset');
  await repository.markSubmitted(
    item.jobId,
    'worker-streak-reset',
    attemptId,
    `0x${'cc'.repeat(32)}`,
  );
  await pool.query(`UPDATE mint_jobs SET status = 'RETRYABLE' WHERE id = $1`, [item.jobId]);
  await pool.query(
    `UPDATE outbox_events SET status = 'LEASED', lease_owner = $2, lease_expires_at = $3 WHERE aggregate_id = $1`,
    [item.jobId, 'worker-streak-reset', new Date(now.getTime() + 30_000)],
  );
  await repository.releaseRetryable(item.jobId, 'worker-streak-reset', 'RPC_UNAVAILABLE');
  assert.equal(await readDelayMs(item.jobId), 1_000);
});

test('finalize resets the retry streak to the base delay for a later re-mint attempt', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000004',
    nextChainEventId: () => '70000000-0000-4000-8000-000000000004',
    nextAssetId: () => '80000000-0000-4000-8000-000000000004',
    retryDelayMs: 1_000,
    maxRetryDelayMs: 60_000,
  });

  const item = await repository.leaseNext('worker-finalize-reset', 30_000);
  assert.ok(item);
  await repository.releaseRetryable(item.jobId, 'worker-finalize-reset', 'RPC_UNAVAILABLE');

  now = new Date(now.getTime() + 60_000);
  const relet = await repository.leaseNext('worker-finalize-reset', 30_000);
  assert.equal(relet?.jobId, item.jobId);
  const attemptId = await repository.markPrepared(relet!, 'worker-finalize-reset');
  const transactionHash = `0x${'dd'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-finalize-reset', attemptId, transactionHash);
  await repository.finalize(relet!, 'worker-finalize-reset', attemptId, {
    transactionHash,
    blockNumber: 4,
    blockHash: `0x${'ee'.repeat(32)}`,
    logIndex: 2,
    tokenId: '1',
    rewardKey: relet!.rewardKey,
    recipient: relet!.recipient,
    seriesKey: relet!.seriesKey,
    contractAddress: relet!.contractAddress,
    chainId: relet!.chainId,
  });

  const streak = await pool.query<{ retry_streak: number }>(
    'SELECT retry_streak FROM mint_jobs WHERE id = $1',
    [item.jobId],
  );
  assert.equal(streak.rows[0]?.retry_streak, 0);
});

test('O02 a database outage stops the worker before any chain call and leaves the queued job intact', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const before = await pool.query<{ job_status: string; outbox_status: string }>(
    `SELECT job.status AS job_status, outbox.status AS outbox_status
     FROM mint_jobs AS job JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id`,
  );

  const chainCalls: string[] = [];
  const gateway = new Proxy({} as MintChainGateway, {
    get: (_target, method) => async () => {
      chainCalls.push(String(method));
      throw new Error('the chain must not be reached while the database is down');
    },
  });
  const unavailablePool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  await unavailablePool.end();

  await assert.rejects(
    new MintWorker(new PostgresMintRepository(unavailablePool, { nftMetadataOrigin: testMetadataOrigin }), gateway).runOnce('worker-db-outage'),
  );
  assert.deepEqual(chainCalls, []);

  const after = await pool.query<{ job_status: string; outbox_status: string }>(
    `SELECT job.status AS job_status, outbox.status AS outbox_status
     FROM mint_jobs AS job JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id`,
  );
  assert.deepEqual(after.rows, before.rows);
  assert.ok(after.rows.length > 0);
});

test('a reverted submission is dropped and released for retry in one transaction', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const readJob = async (jobId: string) =>
    (
      await pool.query<{
        status: string;
        transaction_hash: string | null;
        code: string;
        attempt_status: string;
        outbox_status: string;
      }>(
        `SELECT job.status, job.transaction_hash, job.last_error_code AS code,
                (SELECT status FROM mint_tx_attempts WHERE mint_job_id = job.id) AS attempt_status,
                (SELECT status FROM outbox_events WHERE aggregate_id = job.id) AS outbox_status
         FROM mint_jobs AS job WHERE job.id = $1`,
        [jobId],
      )
    ).rows[0];

  const item = await repository.leaseNext('worker-revert', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-revert');
  await repository.markSubmitted(item.jobId, 'worker-revert', attemptId, `0x${'ab'.repeat(32)}`);

  // Without the lease nothing may change: a half-applied drop would strand a SUBMITTED job.
  await assert.rejects(
    repository.releaseRevertedForRetry(
      item.jobId,
      'another-worker',
      attemptId,
      'MINT_TRANSACTION_REVERTED',
      'MINT_PAUSED',
    ),
  );
  assert.deepEqual(await readJob(item.jobId), {
    status: 'SUBMITTED',
    transaction_hash: `0x${'ab'.repeat(32)}`,
    code: null,
    attempt_status: 'SUBMITTED',
    outbox_status: 'LEASED',
  });

  await repository.releaseRevertedForRetry(
    item.jobId,
    'worker-revert',
    attemptId,
    'MINT_TRANSACTION_REVERTED',
    'MINT_PAUSED',
  );
  assert.deepEqual(await readJob(item.jobId), {
    status: 'RETRYABLE',
    transaction_hash: null,
    code: 'MINT_PAUSED',
    attempt_status: 'FAILED',
    outbox_status: 'PENDING',
  });
});

test('a broadcast transaction awaiting its receipt is not capped by the send limit but times out on the wall clock', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000005',
    maxAttempts: 1,
    receiptTimeoutMs: 60_000,
  });
  const readState = async (jobId: string) =>
    (
      await pool.query<{ status: string; code: string | null; transaction_hash: string | null }>(
        `SELECT status, last_error_code AS code, transaction_hash FROM mint_jobs WHERE id = $1`,
        [jobId],
      )
    ).rows[0];

  const item = await repository.leaseNext('worker-receipt-check', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-receipt-check');
  const transactionHash = `0x${'ab'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-receipt-check', attemptId, transactionHash);

  // At the send cap (maxAttempts: 1) and holding a broadcast hash: a plain result check (no new
  // send) must not be treated as exceeding the send limit.
  await repository.releaseRetryable(item.jobId, 'worker-receipt-check', 'RECEIPT_NOT_READY');
  assert.deepEqual(await readState(item.jobId), {
    status: 'RETRYABLE',
    code: 'RECEIPT_NOT_READY',
    transaction_hash: transactionHash,
  });

  // Re-lease and release again, now past the wall-clock receipt timeout.
  now = new Date(now.getTime() + 61_000);
  const relet = await repository.leaseNext('worker-receipt-check', 30_000);
  assert.equal(relet?.jobId, item.jobId);
  await repository.releaseRetryable(item.jobId, 'worker-receipt-check', 'RECEIPT_NOT_READY');
  assert.deepEqual(await readState(item.jobId), {
    status: 'MANUAL_REVIEW',
    code: 'RECEIPT_TIMEOUT',
    transaction_hash: transactionHash,
  });
});

test('a job at the send cap without a broadcast hash still closes for RETRY_LIMIT_EXCEEDED', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    maxAttempts: 1,
  });
  const item = await repository.leaseNext('worker-presubmit-cap', 30_000);
  assert.ok(item);
  await repository.markPrepared(item, 'worker-presubmit-cap'); // attempt_count -> 1 == maxAttempts

  // A pre-submission transient failure (no transaction_hash on the job) is a would-be new send,
  // so the existing attempt cap still applies.
  await repository.releaseRetryable(item.jobId, 'worker-presubmit-cap', 'RPC_UNAVAILABLE');
  const state = await pool.query<{ status: string; code: string; transaction_hash: string | null }>(
    `SELECT status, last_error_code AS code, transaction_hash FROM mint_jobs WHERE id = $1`,
    [item.jobId],
  );
  assert.deepEqual(state.rows[0], {
    status: 'MANUAL_REVIEW',
    code: 'RETRY_LIMIT_EXCEEDED',
    transaction_hash: null,
  });
});

test('a transaction that confirms after the send cap still finalizes without any duplicate send', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000006',
    nextChainEventId: () => '70000000-0000-4000-8000-000000000006',
    nextAssetId: () => '80000000-0000-4000-8000-000000000006',
    maxAttempts: 1,
    receiptTimeoutMs: 60_000,
  });
  const item = await repository.leaseNext('worker-late-finalize', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-late-finalize'); // attempt_count -> 1
  const transactionHash = `0x${'cd'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-late-finalize', attemptId, transactionHash);

  // A receipt check released at the send cap must not block a later successful confirmation.
  await repository.releaseRetryable(item.jobId, 'worker-late-finalize', 'RECEIPT_NOT_READY');
  now = new Date(now.getTime() + 60_000);
  const relet = await repository.leaseNext('worker-late-finalize', 30_000);
  assert.equal(relet?.jobId, item.jobId);

  await repository.finalize(relet!, 'worker-late-finalize', attemptId, {
    transactionHash,
    blockNumber: 5,
    blockHash: `0x${'ef'.repeat(32)}`,
    logIndex: 0,
    tokenId: '2',
    rewardKey: relet!.rewardKey,
    recipient: relet!.recipient,
    seriesKey: relet!.seriesKey,
    contractAddress: relet!.contractAddress,
    chainId: relet!.chainId,
  });

  const state = await pool.query<{ status: string; attempt_count: number }>(
    `SELECT status, attempt_count FROM mint_jobs WHERE id = $1`,
    [item.jobId],
  );
  assert.deepEqual(state.rows[0], { status: 'FINALIZED', attempt_count: 1 });
});

test('restart recovery drops a reverted hash from a RETRYABLE job and lets the next lease send again', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T05:00:00.000Z');
  const attemptIds = ['60000000-0000-4000-8000-000000000007', '60000000-0000-4000-8000-000000000008'];
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => attemptIds.shift()!,
  });
  const item = await repository.leaseNext('worker-before-restart', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-before-restart');
  const transactionHash = `0x${'ab'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-before-restart', attemptId, transactionHash);
  // The receipt was not ready, so the job waits as RETRYABLE while still holding the hash.
  await repository.releaseRetryable(item.jobId, 'worker-before-restart', 'RECEIPT_NOT_READY');

  now = new Date(now.getTime() + 60_000);
  const afterRestart = await repository.leaseNext('worker-after-restart', 30_000);
  assert.equal(afterRestart?.transactionHash, transactionHash);
  const recoveredAttemptId = await repository.findAttemptIdForTransactionHash(item.jobId, transactionHash);
  assert.equal(recoveredAttemptId, attemptId);
  await repository.releaseRevertedForRetry(
    item.jobId,
    'worker-after-restart',
    recoveredAttemptId!,
    'MINT_TRANSACTION_REVERTED',
    'MINT_PAUSED',
  );

  const job = await pool.query<{ status: string; transaction_hash: string | null; last_error_code: string }>(
    'SELECT status, transaction_hash, last_error_code FROM mint_jobs WHERE id = $1',
    [item.jobId],
  );
  assert.deepEqual(job.rows[0], { status: 'RETRYABLE', transaction_hash: null, last_error_code: 'MINT_PAUSED' });
  const attempt = await pool.query<{ status: string; error_code: string; transaction_hash: string }>(
    'SELECT status, error_code, transaction_hash FROM mint_tx_attempts WHERE id = $1',
    [attemptId],
  );
  // The reverted hash stays on the attempt row as evidence.
  assert.deepEqual(attempt.rows[0], {
    status: 'FAILED',
    error_code: 'MINT_TRANSACTION_REVERTED',
    transaction_hash: transactionHash,
  });
  assert.equal(await repository.findAttemptIdForTransactionHash(item.jobId, transactionHash), undefined);

  now = new Date(now.getTime() + 60_000);
  const resend = await repository.leaseNext('worker-after-restart', 30_000);
  assert.equal(resend?.jobId, item.jobId);
  assert.equal(resend?.transactionHash, undefined);
  assert.equal(await repository.markPrepared(resend!, 'worker-after-restart'), '60000000-0000-4000-8000-000000000008');
});

test('a receipt wait with no submitted attempt behind it closes instead of restarting its clock', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const now = new Date('2026-09-19T06:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000009',
  });
  const item = await repository.leaseNext('worker-orphan-hash', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-orphan-hash');
  await repository.markSubmitted(item.jobId, 'worker-orphan-hash', attemptId, `0x${'12'.repeat(32)}`);
  await pool.query(`UPDATE mint_tx_attempts SET status = 'FAILED' WHERE id = $1`, [attemptId]);

  await repository.releaseRetryable(item.jobId, 'worker-orphan-hash', 'RECEIPT_NOT_READY');

  const job = await pool.query<{ status: string; last_error_code: string }>(
    'SELECT status, last_error_code FROM mint_jobs WHERE id = $1',
    [item.jobId],
  );
  assert.deepEqual(job.rows[0], { status: 'MANUAL_REVIEW', last_error_code: 'RECEIPT_ATTEMPT_MISSING' });
});

test('event scan start reads the cursor with a reorg margin and deployment floor', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    chainFromBlock: 20,
    reorgMargin: 12,
  });
  const contractAddress = '0x7000000000000000000000000000000000000007';

  assert.equal(await repository.getEventScanStart(31337, contractAddress), 20);

  await pool.query(
    `INSERT INTO chain_cursors (
       chain_id, contract_address_normalized, next_block, updated_at
     ) VALUES ($1, $2, 5, now())`,
    [31337, contractAddress.toLowerCase()],
  );
  assert.equal(await repository.getEventScanStart(31337, contractAddress), 20);

  await pool.query(
    `UPDATE chain_cursors
     SET next_block = 120, updated_at = now()
     WHERE chain_id = $1 AND contract_address_normalized = $2`,
    [31337, contractAddress.toLowerCase()],
  );
  assert.equal(await repository.getEventScanStart(31337, contractAddress), 108);

  const closedPool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  await closedPool.end();
  await assert.rejects(
    new PostgresMintRepository(closedPool, { nftMetadataOrigin: testMetadataOrigin }).getEventScanStart(31337, contractAddress),
    (error: unknown) =>
      error instanceof RetryableChainError && error.code === 'CHAIN_CURSOR_READ_FAILED',
  );
});

test('signed_transaction is stored with the attempt and survives a release and a restart lease', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-19T07:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-000000000010',
  });
  const item = await repository.leaseNext('worker-signed-tx', 30_000);
  assert.ok(item);
  assert.equal(item.signedTransaction, undefined);
  const attemptId = await repository.markPrepared(item, 'worker-signed-tx');
  const transactionHash = `0x${'cd'.repeat(32)}`;
  const signedTransaction = `0x${'ef'.repeat(110)}`;
  await repository.markSubmitted(
    item.jobId,
    'worker-signed-tx',
    attemptId,
    transactionHash,
    signedTransaction,
  );

  const attemptRow = await pool.query<{ signed_transaction: string | null }>(
    'SELECT signed_transaction FROM mint_tx_attempts WHERE id = $1',
    [attemptId],
  );
  assert.equal(attemptRow.rows[0]?.signed_transaction, signedTransaction);

  // The receipt was not ready, so the job waits as RETRYABLE while still holding the hash.
  await repository.releaseRetryable(item.jobId, 'worker-signed-tx', 'RECEIPT_NOT_READY');
  const stillStored = await pool.query<{ signed_transaction: string | null }>(
    'SELECT signed_transaction FROM mint_tx_attempts WHERE id = $1',
    [attemptId],
  );
  assert.equal(stillStored.rows[0]?.signed_transaction, signedTransaction);

  now = new Date(now.getTime() + 60_000);
  const afterRestart = await repository.leaseNext('worker-signed-tx-restart', 30_000);
  assert.equal(afterRestart?.transactionHash, transactionHash);
  assert.equal(afterRestart?.signedTransaction, signedTransaction);
});

test('H1 closeForManualReview also closes the job\'s SUBMITTED attempt so it stops being swept', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const item = await repository.leaseNext('worker-manual-review-closes-attempt', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-manual-review-closes-attempt');
  const transactionHash = `0x${'ab'.repeat(32)}`;
  await repository.markSubmitted(
    item.jobId,
    'worker-manual-review-closes-attempt',
    attemptId,
    transactionHash,
    '0x02f801',
  );

  // Before closing: the attempt is still SUBMITTED and the sweep would pick it up.
  assert.deepEqual(await repository.listUnconfirmedSignedTransactions(item.chainId), [
    expectedUnconfirmed(item, transactionHash, '0x02f801'),
  ]);

  await repository.markManualReview(item.jobId, 'worker-manual-review-closes-attempt', 'RECEIPT_TIMEOUT');

  const attempt = await pool.query<{ status: string; error_code: string }>(
    'SELECT status, error_code FROM mint_tx_attempts WHERE id = $1',
    [attemptId],
  );
  assert.deepEqual(attempt.rows[0], { status: 'FAILED', error_code: 'RECEIPT_TIMEOUT' });
  // And it no longer shows up for the sweep: nothing can ever act on this job again.
  assert.deepEqual(await repository.listUnconfirmedSignedTransactions(item.chainId), []);
});

test('H1 finalize supersedes any other SUBMITTED attempt of the same job', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  let now = new Date('2026-09-20T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin,
    now: () => now,
    nextAttemptId: () => '60000000-0000-4000-8000-0000000000a1',
    nextChainEventId: () => '70000000-0000-4000-8000-0000000000a1',
    nextAssetId: () => '80000000-0000-4000-8000-0000000000a1',
  });
  const item = await repository.leaseNext('worker-supersede', 30_000);
  assert.ok(item);
  const firstAttemptId = await repository.markPrepared(item, 'worker-supersede');
  const staleHash = `0x${'a1'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-supersede', firstAttemptId, staleHash, '0x02f801');

  // A second attempt for the same job (e.g. a resubmission after a receipt-not-ready release)
  // that is also still SUBMITTED when the first one actually gets mined.
  const now2 = new Date(now.getTime() + 60_000);
  await pool.query(
    `INSERT INTO mint_tx_attempts (
       id, mint_job_id, attempt_number, status, transaction_hash, signed_transaction,
       prepared_at, submitted_at, updated_at
     ) VALUES ($1, $2, 2, 'SUBMITTED', $3, $4, $5, $5, $5)`,
    [
      '60000000-0000-4000-8000-0000000000a2',
      item.jobId,
      `0x${'a2'.repeat(32)}`,
      '0x02f802',
      now2,
    ],
  );

  const minedHash = staleHash;
  await repository.finalize(item, 'worker-supersede', firstAttemptId, {
    transactionHash: minedHash,
    blockNumber: 4,
    blockHash: `0x${'bb'.repeat(32)}`,
    logIndex: 2,
    tokenId: '1',
    rewardKey: item.rewardKey,
    recipient: item.recipient,
    seriesKey: item.seriesKey,
    contractAddress: item.contractAddress,
    chainId: item.chainId,
  });

  const attempts = await pool.query<{ id: string; status: string; error_code: string | null }>(
    'SELECT id, status, error_code FROM mint_tx_attempts WHERE mint_job_id = $1 ORDER BY attempt_number',
    [item.jobId],
  );
  assert.deepEqual(attempts.rows, [
    { id: firstAttemptId, status: 'MINED', error_code: null },
    {
      id: '60000000-0000-4000-8000-0000000000a2',
      status: 'FAILED',
      error_code: 'SUPERSEDED_BY_ONCHAIN_MINT',
    },
  ]);
});

test('H1 the sweep excludes attempts whose parent job is already terminal', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const item = await repository.leaseNext('worker-sweep-terminal', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-sweep-terminal');
  const transactionHash = `0x${'cd'.repeat(32)}`;
  await repository.markSubmitted(
    item.jobId,
    'worker-sweep-terminal',
    attemptId,
    transactionHash,
    '0x02f803',
  );

  assert.deepEqual(await repository.listUnconfirmedSignedTransactions(item.chainId), [
    expectedUnconfirmed(item, transactionHash, '0x02f803'),
  ]);

  for (const terminalStatus of ['FINALIZED', 'MANUAL_REVIEW', 'CANCELLED']) {
    await pool.query(`UPDATE mint_jobs SET status = $1 WHERE id = $2`, [terminalStatus, item.jobId]);
    assert.deepEqual(
      await repository.listUnconfirmedSignedTransactions(item.chainId),
      [],
      `${terminalStatus} jobs must not be swept`,
    );
  }

  // Back to a non-terminal status: the sweep picks the attempt back up.
  await pool.query(`UPDATE mint_jobs SET status = 'SUBMITTED' WHERE id = $1`, [item.jobId]);
  assert.deepEqual(await repository.listUnconfirmedSignedTransactions(item.chainId), [
    expectedUnconfirmed(item, transactionHash, '0x02f803'),
  ]);
});

test('withMinterLock serializes concurrent callers for the same chain and minter', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const minterAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  let running = 0;
  let maxConcurrent = 0;
  const order: number[] = [];
  const runOne = async (id: number) => {
    await repository.withMinterLock(31337, minterAddress, async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      order.push(id);
      await new Promise((resolve) => setTimeout(resolve, 30));
      running -= 1;
    });
  };

  await Promise.all([runOne(1), runOne(2), runOne(3)]);
  assert.equal(maxConcurrent, 1);
  assert.equal(order.length, 3);

  // A different minter address is not serialized against the first.
  let otherRanWhileLocked = false;
  await Promise.all([
    repository.withMinterLock(31337, minterAddress, async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.withMinterLock(31337, '0x000000000000000000000000000000000000dE0f', async () => {
        otherRanWhileLocked = true;
      });
    })(),
  ]);
  assert.equal(otherRanWhileLocked, true);
});

test('M4 a lock acquisition that times out is retryable and does not hang the worker', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl(), max: 3 });
  t.after(() => pool.end());
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin, minterLockTimeoutMs: 200 });
  const minterAddress = '0x00000000000000000000000000000000BEEF01';

  // Hold the same chain/minter advisory lock from a separate connection, outside the repository.
  const holder = await pool.connect();
  await holder.query('SELECT pg_advisory_lock($1, $2)', advisoryKeyForTest(777701, minterAddress));
  try {
    const startedAt = Date.now();
    await assert.rejects(
      repository.withMinterLock(777701, minterAddress, async () => {
        assert.fail('fn must not run when the lock could not be acquired');
      }),
      (error: unknown) =>
        error instanceof RetryableChainError && error.code === 'MINTER_LOCK_TIMEOUT',
    );
    // A generous ceiling: this only guards against the acquisition hanging indefinitely.
    assert.ok(Date.now() - startedAt < 5_000);
  } finally {
    await holder.query('SELECT pg_advisory_unlock($1, $2)', advisoryKeyForTest(777701, minterAddress));
    holder.release();
  }

  // Once the holder releases, a fresh acquisition for the same chain/minter succeeds normally.
  let acquired = false;
  await repository.withMinterLock(777701, minterAddress, async () => {
    acquired = true;
  });
  assert.equal(acquired, true);
});

test('M4 withMinterLock destroys the connection instead of pooling it when the unlock query fails', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl(), max: 3 });
  t.after(() => pool.end());
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const minterAddress = '0x00000000000000000000000000000000BEEF02';

  // Inject a failure on the unlock query only, on a real pooled connection, so we can observe
  // exactly how that connection is released without tearing down the actual TCP session (which
  // would risk an unhandled 'error' event on a checked-out client racing the assertion).
  const originalConnect = pool.connect.bind(pool);
  let releasedWith: unknown;
  (pool as unknown as { connect: typeof pool.connect }).connect = (async (...args: unknown[]) => {
    const client = await (originalConnect as (...a: unknown[]) => Promise<PoolClient>)(
      ...(args as []),
    );
    const originalQuery = client.query.bind(client);
    const originalRelease = client.release.bind(client);
    client.query = ((...queryArgs: unknown[]) => {
      const sql = typeof queryArgs[0] === 'string' ? queryArgs[0] : '';
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.reject(new Error('SIMULATED_UNLOCK_FAILURE'));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(...queryArgs);
    }) as typeof client.query;
    client.release = ((destroy?: boolean | Error) => {
      releasedWith = destroy;
      return originalRelease(destroy as boolean);
    }) as typeof client.release;
    return client;
  }) as typeof pool.connect;

  try {
    await assert.rejects(
      repository.withMinterLock(777702, minterAddress, async () => 'ok'),
      /SIMULATED_UNLOCK_FAILURE/,
    );
  } finally {
    pool.connect = originalConnect;
  }
  assert.equal(releasedWith, true);

  // The underlying session was actually torn down (not returned to the pool still holding the
  // lock), so PostgreSQL released the advisory lock when that connection closed: a fresh
  // acquisition for the same chain/minter succeeds immediately instead of hanging forever.
  let acquired = false;
  await repository.withMinterLock(777702, minterAddress, async () => {
    acquired = true;
  });
  assert.equal(acquired, true);
});

function advisoryKeyForTest(chainId: number, minterAddress: string): [number, number] {
  const digest = createHash('sha256')
    .update(`mint-minter-lock:${chainId}:${minterAddress.toLowerCase()}`)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

async function seedWorkerFixture(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE wallet_challenges, chain_cursors, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-worker', 'Worker 데모 식당', 'Worker 시험용입니다.', '서울 노원구 데모로 9', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-worker', 'staff-worker', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('campaign-worker', 'merchant-worker', 'Worker 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ('campaign-worker', 1, '첫 Worker 잎새')`,
  );
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash,
       created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES (
       '00000000-0000-4000-8000-000000000021', 'merchant-worker', 'customer-worker',
       decode(repeat('11', 32), 'hex'), 'staff-worker', decode(repeat('22', 32), 'hex'),
       'CLAIMED', '2026-09-19T03:15:00Z', '2026-09-19T03:00:00Z',
       '2026-09-19T02:55:00Z', '2026-09-19T03:00:00Z'
     )`,
  );
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
       occurred_at, business_date, verification_level, status, progress_counted
     ) VALUES (
       '10000000-0000-4000-8000-000000000021',
       '00000000-0000-4000-8000-000000000021',
       'merchant-worker', 'campaign-worker', 'customer-worker', '2026-09-19T03:00:00Z',
       '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
     )`,
  );
  await pool.query(
    `INSERT INTO reward_entitlements (
       id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at
     ) VALUES (
       '20000000-0000-4000-8000-000000000001', 'customer-worker', 'campaign-worker', 1,
       '10000000-0000-4000-8000-000000000021', 'MINT_REQUESTED', 'fixed-1',
       '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z'
     )`,
  );
  await pool.query(
    `INSERT INTO wallet_bindings (
       id, account_id, address_checksum, address_normalized, chain_id,
       binding_version, status, verified_at, created_at, updated_at
     ) VALUES (
       '30000000-0000-4000-8000-000000000021', 'customer-worker',
       '0x4000000000000000000000000000000000000004',
       '0x4000000000000000000000000000000000000004',
       31337, 1, 'VERIFIED', '2026-09-19T03:00:00Z', '2026-09-19T03:00:00Z', '2026-09-19T03:00:00Z'
     )`,
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES (
       's-000000000000000000000000000000f1', 'campaign-worker', 1, 31337,
       '0x7000000000000000000000000000000000000007',
       '0x7000000000000000000000000000000000000007',
       decode(repeat('33', 32), 'hex'), 10, 'ACTIVE'
     )`,
  );
  await pool.query(
    `INSERT INTO mint_jobs (
       id, entitlement_id, account_id, nft_series_id, reward_key,
       wallet_binding_id, binding_version, recipient_address,
       recipient_address_normalized, chain_id, contract_address,
       contract_address_normalized, series_key, consent_version,
       idempotency_key, request_fingerprint, status, created_at, updated_at
     ) VALUES (
       '40000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001', 'customer-worker', 's-000000000000000000000000000000f1',
       decode(repeat('11', 32), 'hex'), '30000000-0000-4000-8000-000000000021', 1,
       '0x4000000000000000000000000000000000000004',
       '0x4000000000000000000000000000000000000004',
       31337, '0x7000000000000000000000000000000000000007',
       '0x7000000000000000000000000000000000000007',
       decode(repeat('33', 32), 'hex'), 'nft-mint-v1', 'worker-idempotency',
       decode(repeat('44', 32), 'hex'), 'QUEUED', '2026-09-19T03:00:00Z', '2026-09-19T03:00:00Z'
     )`,
  );
  await pool.query(
    `INSERT INTO outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, status,
       available_at, created_at, updated_at
     ) VALUES (
       '50000000-0000-4000-8000-000000000001', 'MINT_JOB',
       '40000000-0000-4000-8000-000000000001', 'MINT_REQUESTED',
       '{"jobId":"40000000-0000-4000-8000-000000000001"}',
       'PENDING', '2026-09-19T03:00:00Z', '2026-09-19T03:00:00Z', '2026-09-19T03:00:00Z'
     )`,
  );
}

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}

// Issue #254: 발행 확정(finalize) 때 공개 메타데이터를 고정한다.
async function finalizeFixtureJob(pool: Pool, repository: PostgresMintRepository, workerId: string) {
  const item = await repository.leaseNext(workerId, 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, workerId);
  const transactionHash = `0x${'ab'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, workerId, attemptId, transactionHash);
  const before = await pool.query('SELECT 1 FROM nft_token_metadata');
  assert.equal(before.rowCount, 0, 'no metadata before chain confirmation');
  const result: ChainMintResult = {
    transactionHash, blockNumber: 4, blockHash: `0x${'bc'.repeat(32)}`, logIndex: 0, tokenId: '7',
    rewardKey: item.rewardKey, recipient: item.recipient, seriesKey: item.seriesKey,
    contractAddress: item.contractAddress, chainId: item.chainId,
  };
  await repository.finalize(item, workerId, attemptId, result);
  return { item, attemptId, result };
}

type SavedMetadata = { nft_series_id: string; token_id: string; metadata_json: string; image_sha256: string | null };

async function savedMetadata(pool: Pool): Promise<SavedMetadata[]> {
  return (await pool.query<SavedMetadata>(
    'SELECT nft_series_id, token_id::text, metadata_json, image_sha256 FROM nft_token_metadata',
  )).rows;
}

test('#254 확정 때 가게 이름·동네·업종·방문 단계·캠페인과 적용된 가게 그림을 고정하고 개인 정보는 넣지 않는다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const art = Buffer.from('fixture-webp-bytes-254');
  const sha = createHash('sha256').update(art).digest('hex');
  await pool.query(`UPDATE merchants SET neighborhood = '월계1동', category = '분식' WHERE id = 'merchant-worker'`);
  await pool.query('INSERT INTO merchant_art (merchant_id, image, sha256) VALUES ($1, $2, $3)',
    ['merchant-worker', art, sha]);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: 'https://demo-api.masscom.kr' });

  await finalizeFixtureJob(pool, repository, 'worker-metadata');

  const rows = await savedMetadata(pool);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.nft_series_id, 's-000000000000000000000000000000f1');
  assert.equal(rows[0]!.token_id, '7');
  assert.equal(rows[0]!.image_sha256, sha);
  assert.deepEqual(JSON.parse(rows[0]!.metadata_json), {
    name: 'Worker 데모 식당 방문 도장',
    description: '월계1동 Worker 데모 식당 첫 방문 도장입니다. 월계 마스코트 방문 도감이 발행한 기념 NFT이며 다른 지갑으로 보낼 수 없습니다.',
    image: `https://demo-api.masscom.kr/nft-metadata/images/${sha}.webp`,
    attributes: [
      { trait_type: '가게 이름', value: 'Worker 데모 식당' },
      { trait_type: '동네', value: '월계1동' },
      { trait_type: '업종', value: '분식' },
      { trait_type: '방문 단계', value: '첫 방문' },
      { trait_type: '캠페인', value: 'Worker 도감' },
      { trait_type: '그림', value: 'AI 생성' },
    ],
  });
  for (const hidden of ['데모로', '2026-', 'customer-worker', '0x4000000000000000000000000000000000000004', 'Worker 시험용']) {
    assert.equal(rows[0]!.metadata_json.includes(hidden), false, hidden);
  }
  const image = await pool.query<{ image: Buffer }>('SELECT image FROM nft_metadata_images WHERE sha256 = $1', [sha]);
  assert.deepEqual(image.rows[0]?.image, art);
});

test('#254 가게 정보·그림이 바뀌고 확정을 다시 해도 이미 고정한 메타데이터·그림은 그대로이고 수정·삭제는 DB가 막는다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const art = Buffer.from('fixture-webp-original');
  const sha = createHash('sha256').update(art).digest('hex');
  await pool.query(`UPDATE merchants SET neighborhood = '월계동', category = '한식' WHERE id = 'merchant-worker'`);
  await pool.query('INSERT INTO merchant_art (merchant_id, image, sha256) VALUES ($1, $2, $3)',
    ['merchant-worker', art, sha]);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const { item, attemptId, result } = await finalizeFixtureJob(pool, repository, 'worker-immutable');
  const [original] = await savedMetadata(pool);
  assert.ok(original);
  assert.match(JSON.parse(original.metadata_json).image, /^https:\/\/masscom\.kr\/nft-metadata\/images\//);

  // 가게가 이름·동네·업종·캠페인을 고치고 그림을 되돌린다(merchant_art 행 삭제).
  await pool.query(`UPDATE merchants SET name = '바뀐 이름', neighborhood = '중계동', category = '카페' WHERE id = 'merchant-worker'`);
  await pool.query(`UPDATE campaigns SET title = '바뀐 캠페인' WHERE id = 'campaign-worker'`);
  await pool.query(`DELETE FROM merchant_art WHERE merchant_id = 'merchant-worker'`);
  // 같은 결과로 다시 확정해도(재시작·경합 복구) 스냅샷은 한 행 그대로다.
  await repository.finalize(item, 'worker-immutable', attemptId, result);
  assert.deepEqual(await savedMetadata(pool), [original]);
  const image = await pool.query<{ image: Buffer }>('SELECT image FROM nft_metadata_images WHERE sha256 = $1', [sha]);
  assert.deepEqual(image.rows[0]?.image, art, 'reverted art stays served for the minted token');

  await assert.rejects(pool.query(`UPDATE nft_token_metadata SET metadata_json = '{}'`), /immutable/);
  await assert.rejects(pool.query('DELETE FROM nft_token_metadata'), /immutable/);
  await assert.rejects(pool.query(`UPDATE nft_metadata_images SET image = '\\x00'::bytea`), /immutable/);
  assert.deepEqual(await savedMetadata(pool), [original]);
  // 신고된 그림은 운영자가 그림 행만 내릴 수 있고(주소는 404), 메타데이터는 그대로 남는다.
  await pool.query('DELETE FROM nft_metadata_images WHERE sha256 = $1', [sha]);
  assert.deepEqual(await savedMetadata(pool), [original]);
});

test('#254 가게 그림이 없으면 기본 도장이고 동네·업종이 없으면 그 속성을 빼며, 경로에 쓸 수 없는 시리즈 id는 새로 만들 수 없다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  await finalizeFixtureJob(pool, new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), 'worker-default');
  const [saved] = await savedMetadata(pool);
  assert.equal(saved?.image_sha256, null);
  const metadata = JSON.parse(saved!.metadata_json);
  assert.equal(metadata.image, 'https://masscom.kr/nft-metadata/default/mascot-stamp-v1.png');
  assert.deepEqual(metadata.attributes.map((item: { trait_type: string }) => item.trait_type), ['가게 이름', '방문 단계', '캠페인']);

  // 불투명 id(s- + 소문자 hex 32자)만 받는다. 가게 이름이 들어간 id는 영구 공개 주소에 남으므로 거절한다.
  for (const id of ['base-sepolia-proof', 'BASE-SEPOLIA-PROOF', 'Base-Sepolia-Proof', 'has space', 'dot.id', '-leading',
    'a'.repeat(129), 'wolgye-kimbap-3', 'series-worker', `S-${'a'.repeat(32)}`, `s-${'A'.repeat(32)}`, `s-${'a'.repeat(31)}`,
    `s-${'a'.repeat(33)}`, `s-${'g'.repeat(32)}`]) {
    await assert.rejects(pool.query(
      `INSERT INTO nft_series (id, campaign_id, target_visit_count, chain_id, contract_address,
         contract_address_normalized, series_key, max_ever_minted, status)
       VALUES ($1, 'campaign-worker', 1, 31337, '0x7000000000000000000000000000000000000008',
         '0x7000000000000000000000000000000000000008', decode(repeat('55', 32), 'hex'), 1, 'DRAFT')`,
      [id],
    ), /nft_series_metadata_path_check/, id);
  }
});

test('#254 공개 중이 아닌 점포(숨김·동의서 없는 실제 점포)는 가게를 드러내지 않는 일반 도장이고, 동의서가 있는 공개 점포는 가게 정보를 담는다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  const art = Buffer.from('fixture-webp-hidden-store');
  const sha = createHash('sha256').update(art).digest('hex');
  for (const [label, update, storePublic] of [
    ['hidden demo store', `UPDATE merchants SET status = 'PAUSED'`, false],
    ['real store without consent', `UPDATE merchants SET is_demo = false, consent_document_ref = NULL`, false],
    ['real published store', `UPDATE merchants SET is_demo = false, consent_document_ref = 'CS-2609-01'`, true],
  ] as const) {
    await seedWorkerFixture(pool);
    await pool.query(`UPDATE merchants SET neighborhood = '월계동', category = '카페' WHERE id = 'merchant-worker'`);
    await pool.query(`${update} WHERE id = 'merchant-worker'`);
    await pool.query('INSERT INTO merchant_art (merchant_id, image, sha256) VALUES ($1, $2, $3)',
      ['merchant-worker', art, sha]);
    await finalizeFixtureJob(pool, new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), `worker-${label}`);
    const [saved] = await savedMetadata(pool);
    const metadata = JSON.parse(saved!.metadata_json);
    if (storePublic) {
      assert.equal(metadata.name, 'Worker 데모 식당 방문 도장', label);
      assert.equal(saved!.image_sha256, sha, label);
    } else {
      assert.deepEqual(metadata, {
        name: '월계 방문 도장',
        description: '월계 마스코트 방문 도감의 첫 방문 도장입니다. 다른 지갑으로 보낼 수 없는 기념 NFT입니다.',
        image: 'https://masscom.kr/nft-metadata/default/mascot-stamp-v1.png',
        attributes: [{ trait_type: '방문 단계', value: '첫 방문' }],
      }, label);
      assert.equal(saved!.image_sha256, null, label);
      for (const hidden of ['Worker 데모 식당', '월계동', '카페', 'Worker 도감']) {
        assert.equal(saved!.metadata_json.includes(hidden), false, `${label}: ${hidden}`);
      }
    }
  }
});

test('#254 운영자가 내린 그림(거부 목록)은 스냅샷이 복사하지 않고 기본 도장을 쓴다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);
  const art = Buffer.from('fixture-webp-reported');
  const sha = createHash('sha256').update(art).digest('hex');
  await pool.query('TRUNCATE nft_metadata_takedowns');
  await pool.query('INSERT INTO merchant_art (merchant_id, image, sha256) VALUES ($1, $2, $3)',
    ['merchant-worker', art, sha]);
  await pool.query(`INSERT INTO nft_metadata_takedowns (target, reason) VALUES ($1, '신고된 그림')`, [`image:${sha}`]);
  await finalizeFixtureJob(pool, new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), 'worker-takedown');
  const [saved] = await savedMetadata(pool);
  assert.equal(saved!.image_sha256, null);
  assert.equal(JSON.parse(saved!.metadata_json).image, 'https://masscom.kr/nft-metadata/default/mascot-stamp-v1.png');
  assert.equal(saved!.metadata_json.includes('AI 생성'), false);
  assert.equal((await pool.query('SELECT 1 FROM nft_metadata_images WHERE sha256 = $1', [sha])).rowCount, 0);
  await pool.query('TRUNCATE nft_metadata_takedowns');
});

test('#254 스냅샷이 실패하면 확정 전체가 되돌아가 NFT_METADATA_SNAPSHOT_FAILED로 재시도하고, 원인이 풀리면 다음 확정이 스냅샷과 함께 끝난다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(async () => {
    await pool.query('DROP TRIGGER IF EXISTS nft_token_metadata_test_failure ON nft_token_metadata');
    await pool.query('DROP FUNCTION IF EXISTS nft_token_metadata_test_failure()');
    await pool.end();
  });
  await seedWorkerFixture(pool);
  await pool.query(`CREATE FUNCTION nft_token_metadata_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'injected snapshot failure'; END; $$`);
  await pool.query(`CREATE TRIGGER nft_token_metadata_test_failure BEFORE INSERT ON nft_token_metadata
    FOR EACH ROW EXECUTE FUNCTION nft_token_metadata_test_failure()`);
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const item = await repository.leaseNext('worker-snapshot-failure', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-snapshot-failure');
  const transactionHash = `0x${'cd'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-snapshot-failure', attemptId, transactionHash);
  const result: ChainMintResult = {
    transactionHash, blockNumber: 5, blockHash: `0x${'ce'.repeat(32)}`, logIndex: 0, tokenId: '8',
    rewardKey: item.rewardKey, recipient: item.recipient, seriesKey: item.seriesKey,
    contractAddress: item.contractAddress, chainId: item.chainId,
  };
  await assert.rejects(repository.finalize(item, 'worker-snapshot-failure', attemptId, result),
    (error: unknown) => error instanceof RetryableChainError && error.code === 'NFT_METADATA_SNAPSHOT_FAILED');
  const rolledBack = await pool.query<{ assets: number; events: number; status: string }>(
    `SELECT (SELECT count(*)::integer FROM nft_assets) AS assets, (SELECT count(*)::integer FROM chain_events) AS events,
       (SELECT status FROM mint_jobs WHERE id = $1) AS status`, [item.jobId],
  );
  assert.equal(rolledBack.rows[0]?.assets, 0);
  assert.equal(rolledBack.rows[0]?.events, 0);
  assert.notEqual(rolledBack.rows[0]?.status, 'FINALIZED');
  // 작업자는 이 코드로 재시도 대기에 둔다(last_error_code).
  await repository.releaseRetryable(item.jobId, 'worker-snapshot-failure', 'NFT_METADATA_SNAPSHOT_FAILED');
  const released = await pool.query<{ status: string; last_error_code: string }>(
    'SELECT status, last_error_code FROM mint_jobs WHERE id = $1', [item.jobId]);
  assert.deepEqual(released.rows[0], { status: 'RETRYABLE', last_error_code: 'NFT_METADATA_SNAPSHOT_FAILED' });

  await pool.query('DROP TRIGGER nft_token_metadata_test_failure ON nft_token_metadata');
  await pool.query(`UPDATE outbox_events SET available_at = now() - interval '1 second' WHERE aggregate_id = $1`, [item.jobId]);
  const relet = await repository.leaseNext('worker-snapshot-retry', 30_000);
  assert.equal(relet?.jobId, item.jobId);
  await repository.finalize(relet!, 'worker-snapshot-retry', undefined, result);
  const done = await pool.query<{ status: string; snapshots: number }>(
    `SELECT (SELECT status FROM mint_jobs WHERE id = $1) AS status,
       (SELECT count(*)::integer FROM nft_token_metadata) AS snapshots`, [item.jobId],
  );
  assert.deepEqual(done.rows[0], { status: 'FINALIZED', snapshots: 1 });
});

test('#254 발행 뒤 스냅샷 실패가 결과 대기 시간을 넘겨도 원인 코드를 남기고 채굴된 시도는 SUBMITTED로 두며, 원인을 고쳐 되돌리면 확정된다', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (line: unknown) => { errors.push(String(line)); };
  t.after(async () => {
    console.error = originalError;
    await pool.query('DROP TRIGGER IF EXISTS nft_token_metadata_test_timeout ON nft_token_metadata');
    await pool.query('DROP FUNCTION IF EXISTS nft_token_metadata_test_timeout()');
    await pool.end();
  });
  await seedWorkerFixture(pool);
  await pool.query(`CREATE FUNCTION nft_token_metadata_test_timeout() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'secret-looking value 0x4000000000000000000000000000000000000004'; END; $$`);
  await pool.query(`CREATE TRIGGER nft_token_metadata_test_timeout BEFORE INSERT ON nft_token_metadata
    FOR EACH ROW EXECUTE FUNCTION nft_token_metadata_test_timeout()`);
  let now = new Date('2026-09-30T00:00:00.000Z');
  const repository = new PostgresMintRepository(pool, {
    nftMetadataOrigin: testMetadataOrigin, now: () => now, receiptTimeoutMs: 60_000,
  });
  const item = await repository.leaseNext('worker-timeout', 30_000);
  assert.ok(item);
  const attemptId = await repository.markPrepared(item, 'worker-timeout');
  const transactionHash = `0x${'de'.repeat(32)}`;
  await repository.markSubmitted(item.jobId, 'worker-timeout', attemptId, transactionHash);
  const result: ChainMintResult = {
    transactionHash, blockNumber: 6, blockHash: `0x${'df'.repeat(32)}`, logIndex: 0, tokenId: '9',
    rewardKey: item.rewardKey, recipient: item.recipient, seriesKey: item.seriesKey,
    contractAddress: item.contractAddress, chainId: item.chainId,
  };
  const failOnce = async (workerId: string, current = item) => {
    await assert.rejects(repository.finalize(current, workerId, attemptId, result),
      (error: unknown) => error instanceof RetryableChainError && error.code === 'NFT_METADATA_SNAPSHOT_FAILED');
    await repository.releaseRetryable(item.jobId, workerId, 'NFT_METADATA_SNAPSHOT_FAILED');
  };
  await failOnce('worker-timeout');
  // 원인은 SQLSTATE·제약 이름만 한 번 남기고 값·메시지는 남기지 않는다.
  assert.equal(errors.length, 1);
  assert.deepEqual(JSON.parse(errors[0]!), { event: 'NFT_METADATA_SNAPSHOT_FAILED', sqlstate: 'P0001', constraint: null });
  assert.equal(errors[0]!.includes('0x4000'), false);

  now = new Date(now.getTime() + 61_000);
  const late = await repository.leaseNext('worker-timeout-late', 30_000);
  assert.equal(late?.jobId, item.jobId);
  await failOnce('worker-timeout-late', late!);
  const closed = await pool.query<{ status: string; last_error_code: string; attempt_status: string; outbox_status: string }>(
    `SELECT job.status, job.last_error_code, attempt.status AS attempt_status, outbox.status AS outbox_status
     FROM mint_jobs AS job
     JOIN mint_tx_attempts AS attempt ON attempt.mint_job_id = job.id
     JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
     WHERE job.id = $1`, [item.jobId],
  );
  assert.deepEqual(closed.rows[0], {
    status: 'MANUAL_REVIEW', last_error_code: 'NFT_METADATA_SNAPSHOT_FAILED', attempt_status: 'SUBMITTED', outbox_status: 'PUBLISHED',
  });
  // 수동 검토로 닫힌 작업의 SUBMITTED 시도는 재전송 대상에서 빠진다.
  assert.deepEqual(await repository.listUnconfirmedSignedTransactions(item.chainId), []);

  // 운영 절차: 원인을 고치고 작업을 RETRYABLE·Outbox를 PENDING으로 되돌리면 다음 확정이 끝난다.
  await pool.query('DROP TRIGGER nft_token_metadata_test_timeout ON nft_token_metadata');
  await pool.query(`UPDATE mint_jobs SET status = 'RETRYABLE', updated_at = $2 WHERE id = $1`, [item.jobId, now]);
  await pool.query(`UPDATE outbox_events SET status = 'PENDING', available_at = $2, updated_at = $2 WHERE aggregate_id = $1`,
    [item.jobId, now]);
  const requeued = await repository.leaseNext('worker-requeued', 30_000);
  assert.equal(requeued?.jobId, item.jobId);
  await repository.finalize(requeued!, 'worker-requeued', undefined, result);
  const finalized = await pool.query<{ status: string; attempt_status: string; snapshots: number }>(
    `SELECT job.status, attempt.status AS attempt_status,
       (SELECT count(*)::integer FROM nft_token_metadata) AS snapshots
     FROM mint_jobs AS job JOIN mint_tx_attempts AS attempt ON attempt.mint_job_id = job.id WHERE job.id = $1`, [item.jobId],
  );
  assert.deepEqual(finalized.rows[0], { status: 'FINALIZED', attempt_status: 'MINED', snapshots: 1 });
});
