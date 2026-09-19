import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAddress } from 'ethers';
import { Pool } from 'pg';

import { MintRequestError } from './mint-request-service.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { runMigrations } from './postgres/migrate.js';

test('W07 M01 M07 mint request atomically freezes recipient and replays one job', async (t) => {
  const connectionString = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedMintFixture(pool);

  let now = new Date('2026-09-19T03:00:00.000Z');
  const bindingIds = [
    '30000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000013',
  ];
  const bindingStore = new PostgresWalletBindingStore(pool, {
    now: () => now,
    nextId: () => bindingIds.shift()!,
  });
  const firstAddress = getAddress('0x4000000000000000000000000000000000000004');
  const changedAddress = getAddress('0x5000000000000000000000000000000000000005');
  const secondAccountAddress = getAddress('0x6000000000000000000000000000000000000006');
  const firstBinding = await bindingStore.recordVerified({
    accountId: 'customer-1',
    address: firstAddress,
    chainId: 84532,
  });
  const secondBinding = await bindingStore.recordVerified({
    accountId: 'customer-2',
    address: secondAccountAddress,
    chainId: 84532,
  });

  const jobIds = [
    '40000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
  ];
  const outboxIds = [
    '50000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
  ];
  const rewardKeys = [Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22)];
  const service = new PostgresMintRequestService(pool, {
    now: () => now,
    nextJobId: () => jobIds.shift()!,
    nextOutboxId: () => outboxIds.shift()!,
    nextRewardKey: () => rewardKeys.shift()!,
    supportedConsentVersion: 'nft-mint-v1',
  });
  const input = {
    accountId: 'customer-1',
    entitlementId: '20000000-0000-4000-8000-000000000001',
    walletBindingId: firstBinding.bindingId,
    bindingVersion: firstBinding.bindingVersion,
    consentVersion: 'nft-mint-v1',
    idempotencyKey: 'mint-request-1',
  } as const;

  const race = await Promise.all(
    Array.from({ length: 20 }, () => service.requestMint(input)),
  );
  assert.equal(new Set(race.map((result) => result.jobId)).size, 1);
  assert.equal(race.filter((result) => result.replayed === false).length, 1);
  assert.equal(race.filter((result) => result.replayed === true).length, 19);
  const created = race.find((result) => result.replayed === false)!;
  assert.deepEqual(created, {
    jobId: '40000000-0000-4000-8000-000000000001',
    status: 'QUEUED',
    chainId: 84532,
    recipient: firstAddress,
    nft: null,
    replayed: false,
  });

  const counts = await pool.query<{
    jobs: number;
    outbox: number;
    requested: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM mint_jobs) AS jobs,
       (SELECT count(*)::integer FROM outbox_events) AS outbox,
       (SELECT count(*)::integer FROM reward_entitlements WHERE status = 'MINT_REQUESTED') AS requested`,
  );
  assert.deepEqual(counts.rows[0], { jobs: 1, outbox: 1, requested: 1 });

  now = new Date('2026-09-19T03:01:00.000Z');
  const changedBinding = await bindingStore.recordVerified({
    accountId: 'customer-1',
    address: changedAddress,
    chainId: 84532,
  });
  assert.equal(changedBinding.bindingVersion, 2);

  const persisted = await service.getMintJob({
    accountId: 'customer-1',
    jobId: created.jobId,
  });
  assert.equal(persisted.recipient, firstAddress);
  assert.equal(persisted.walletBindingId, firstBinding.bindingId);
  assert.equal(persisted.bindingVersion, 1);

  await assert.rejects(
    service.requestMint({
      ...input,
      entitlementId: '20000000-0000-4000-8000-000000000002',
    }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'IDEMPOTENCY_CONFLICT',
  );

  await assert.rejects(
    service.requestMint({ ...input, idempotencyKey: 'mint-request-2' }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'MINT_PENDING',
  );

  await assert.rejects(
    service.requestMint({
      accountId: 'customer-1',
      entitlementId: '20000000-0000-4000-8000-000000000002',
      walletBindingId: changedBinding.bindingId,
      bindingVersion: 1,
      consentVersion: 'nft-mint-v1',
      idempotencyKey: 'mint-request-3',
    }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'WALLET_BINDING_CHANGED',
  );

  await assert.rejects(
    service.requestMint({
      accountId: 'customer-2',
      entitlementId: '20000000-0000-4000-8000-000000000003',
      walletBindingId: secondBinding.bindingId,
      bindingVersion: secondBinding.bindingVersion,
      consentVersion: 'nft-mint-v1',
      idempotencyKey: 'mint-request-capacity',
    }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'CAPACITY_UNAVAILABLE',
  );
});

async function seedMintFixture(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE wallet_challenges, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-a', 'A 데모 식당', '민팅 시험용입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('campaign-a', 'merchant-a', '가을 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ('campaign-a', 1, '첫 잎새'), ('campaign-a', 3, '단골 새싹'), ('campaign-a', 5, '월계수 관')`,
  );
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash,
       created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES
       ('00000000-0000-4000-8000-000000000011', 'merchant-a', 'customer-1', decode(repeat('11', 32), 'hex'), 'staff-a', decode(repeat('21', 32), 'hex'), 'CLAIMED', '2026-09-19T03:15:00Z', '2026-09-19T03:00:00Z', '2026-09-19T02:55:00Z', '2026-09-19T03:00:00Z'),
       ('00000000-0000-4000-8000-000000000012', 'merchant-a', 'customer-2', decode(repeat('12', 32), 'hex'), 'staff-a', decode(repeat('22', 32), 'hex'), 'CLAIMED', '2026-09-18T03:15:00Z', '2026-09-18T03:00:00Z', '2026-09-18T02:55:00Z', '2026-09-18T03:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
       occurred_at, business_date, verification_level, status, progress_counted
     ) VALUES
       ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011', 'merchant-a', 'campaign-a', 'customer-1', '2026-09-19T03:00:00Z', '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true),
       ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012', 'merchant-a', 'campaign-a', 'customer-2', '2026-09-18T03:00:00Z', '2026-09-18', 'MERCHANT_CONFIRMED', 'VALID', true)`,
  );
  await pool.query(
    `INSERT INTO reward_entitlements (
       id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at
     ) VALUES
       ('20000000-0000-4000-8000-000000000001', 'customer-1', 'campaign-a', 1, '10000000-0000-4000-8000-000000000011', 'GRANTED', 'fixed-1', '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z'),
       ('20000000-0000-4000-8000-000000000002', 'customer-1', 'campaign-a', 3, '10000000-0000-4000-8000-000000000011', 'GRANTED', 'fixed-1', '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z'),
       ('20000000-0000-4000-8000-000000000003', 'customer-2', 'campaign-a', 1, '10000000-0000-4000-8000-000000000012', 'GRANTED', 'fixed-1', '2026-09-18T03:00:00Z', '2026-12-17T03:00:00Z')`,
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES (
       'series-a-goal-1', 'campaign-a', 1, 84532,
       '0x7000000000000000000000000000000000000007',
       '0x7000000000000000000000000000000000000007',
       decode(repeat('33', 32), 'hex'), 1, 'ACTIVE'
     ), (
       'series-a-goal-3', 'campaign-a', 3, 84532,
       '0x7000000000000000000000000000000000000007',
       '0x7000000000000000000000000000000000000007',
       decode(repeat('44', 32), 'hex'), 10, 'ACTIVE'
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
