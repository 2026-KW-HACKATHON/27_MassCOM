import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMintRepository } from './postgres-mint-repository.js';
import {
  MintWorker,
  RetryableChainError,
  type ChainMintResult,
  type MintChainGateway,
} from './mint-worker.js';

test('M03 M06 lease race, retry, finalization, and repeated event ingestion stay idempotent', async (t) => {
  const connectionString = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await seedWorkerFixture(pool);

  let now = new Date('2026-09-19T04:00:00.000Z');
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool);
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
    new MintWorker(new PostgresMintRepository(unavailablePool), gateway).runOnce('worker-db-outage'),
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
  const repository = new PostgresMintRepository(pool);
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
  const repository = new PostgresMintRepository(pool, {
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
    new PostgresMintRepository(closedPool).getEventScanStart(31337, contractAddress),
    (error: unknown) =>
      error instanceof RetryableChainError && error.code === 'CHAIN_CURSOR_READ_FAILED',
  );
});

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
       'series-worker', 'campaign-worker', 1, 31337,
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
       '20000000-0000-4000-8000-000000000001', 'customer-worker', 'series-worker',
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
