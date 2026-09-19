import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMintRepository } from './postgres-mint-repository.js';
import { RetryableChainError, type ChainMintResult } from './mint-worker.js';

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
    'TRUNCATE chain_cursors, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
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
