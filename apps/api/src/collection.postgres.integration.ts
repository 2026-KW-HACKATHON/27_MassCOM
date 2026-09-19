import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresCollectionReader } from './postgres/collection.js';
import { runMigrations } from './postgres/migrate.js';

test('collection separates valid visits, app collectibles, and NFT state without exact meal time', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }

  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    'TRUNCATE reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-a', 'A 데모 식당', '도감 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES (
       'campaign-a', 'merchant-a', '가을 방문 도감',
       '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100
     )`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES
       ('campaign-a', 1, '첫 방문 마스코트'),
       ('campaign-a', 3, '세 번째 방문 마스코트'),
       ('campaign-a', 5, '다섯 번째 방문 마스코트')`,
  );
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash,
       created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES (
       '00000000-0000-4000-8000-000000000001', 'merchant-a', 'customer-1',
       decode(repeat('11', 32), 'hex'), 'staff-a', decode(repeat('22', 32), 'hex'),
       'CLAIMED', '2026-09-19T03:15:00Z', '2026-09-19T03:00:00Z',
       '2026-09-19T02:55:00Z', '2026-09-19T03:00:00Z'
     )`,
  );
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
       occurred_at, business_date, verification_level, status, progress_counted
     ) VALUES (
       '10000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000001',
       'merchant-a', 'campaign-a', 'customer-1', '2026-09-19T03:00:00Z',
       '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
     )`,
  );
  await pool.query(
    `INSERT INTO reward_entitlements (
       id, customer_account_id, campaign_id, target_visit_count,
       source_visit_event_id, status, policy_version, earned_at, claim_expires_at
     ) VALUES
       ('20000000-0000-4000-8000-000000000001', 'customer-1', 'campaign-a', 1,
        '10000000-0000-4000-8000-000000000001', 'GRANTED', 'fixed-1',
        '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z'),
       ('20000000-0000-4000-8000-000000000002', 'customer-1', 'campaign-a', 3,
        '10000000-0000-4000-8000-000000000001', 'MINT_REQUESTED', 'fixed-1',
        '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z'),
       ('20000000-0000-4000-8000-000000000003', 'customer-1', 'campaign-a', 5,
        '10000000-0000-4000-8000-000000000001', 'FULFILLED', 'fixed-1',
        '2026-09-19T03:00:00Z', '2026-12-18T03:00:00Z')`,
  );

  const result = await new PostgresCollectionReader(pool).getCollection('customer-1');

  assert.deepEqual(result, {
    visits: [
      {
        visitEventId: '10000000-0000-4000-8000-000000000001',
        merchantId: 'merchant-a',
        merchantName: 'A 데모 식당',
        campaignId: 'campaign-a',
        campaignTitle: '가을 방문 도감',
        businessDate: '2026-09-19',
        progressCounted: true,
        verificationLevel: 'MERCHANT_CONFIRMED',
      },
    ],
    collectibles: [
      {
        entitlementId: '20000000-0000-4000-8000-000000000003',
        merchantId: 'merchant-a',
        merchantName: 'A 데모 식당',
        campaignId: 'campaign-a',
        campaignTitle: '가을 방문 도감',
        targetVisitCount: 5,
        displayName: '다섯 번째 방문 마스코트',
        appCollectibleStatus: 'COLLECTED',
        nftStatus: 'FULFILLED',
      },
      {
        entitlementId: '20000000-0000-4000-8000-000000000002',
        merchantId: 'merchant-a',
        merchantName: 'A 데모 식당',
        campaignId: 'campaign-a',
        campaignTitle: '가을 방문 도감',
        targetVisitCount: 3,
        displayName: '세 번째 방문 마스코트',
        appCollectibleStatus: 'COLLECTED',
        nftStatus: 'REQUESTED',
      },
      {
        entitlementId: '20000000-0000-4000-8000-000000000001',
        merchantId: 'merchant-a',
        merchantName: 'A 데모 식당',
        campaignId: 'campaign-a',
        campaignTitle: '가을 방문 도감',
        targetVisitCount: 1,
        displayName: '첫 방문 마스코트',
        appCollectibleStatus: 'COLLECTED',
        nftStatus: 'NOT_REQUESTED',
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /occurredAt|token|merchantReference/);
});
