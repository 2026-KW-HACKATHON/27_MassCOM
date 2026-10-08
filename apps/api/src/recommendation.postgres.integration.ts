import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { runMigrations } from './postgres/migrate.js';
import type { CourseView } from './course-rules.js';

test('recommendation candidates combine active campaigns with account progress', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
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
     VALUES
       ('merchant-new', '새 가게', '추천 시험용입니다.', '서울 노원구 새길 1', 7000, 'ACTIVE', true),
       ('merchant-visited', '다시 갈 가게', '추천 시험용입니다.', '서울 노원구 다시길 2', 9000, 'ACTIVE', true),
       ('merchant-full', '정원 마감 가게', '추천 시험용입니다.', '서울 노원구 마감길 3', 8000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count)
     VALUES
       ('campaign-new', 'merchant-new', '새 가게 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10, 0),
       ('campaign-visited', 'merchant-visited', '다시 가기 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10, 2),
       ('campaign-full', 'merchant-full', '마감 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 2, 2)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     SELECT campaign_id, target_visit_count,
       CASE target_visit_count WHEN 1 THEN '첫 잎새' WHEN 3 THEN '단골 새싹' ELSE '월계수 관' END
     FROM (VALUES ('campaign-new'), ('campaign-visited'), ('campaign-full')) AS campaigns(campaign_id)
     CROSS JOIN (VALUES (1), (3), (5)) AS goals(target_visit_count)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-visited', 'staff-1', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash,
       created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES (
       '00000000-0000-4000-8000-000000000001', 'merchant-visited', 'customer-1',
       decode(repeat('11', 32), 'hex'), 'staff-1', decode(repeat('22', 32), 'hex'),
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
       'merchant-visited', 'campaign-visited', 'customer-1', '2026-09-19T03:00:00Z',
       '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
     )`,
  );

  const result = await new PostgresRecommendationSource(
    pool,
    () => new Date('2026-09-19T04:00:00.000Z'),
  ).listCandidates('customer-1');

  assert.deepEqual(
    result.map(({ merchantId, enrollmentStatus, progressVisitCount }) => ({ merchantId, enrollmentStatus, progressVisitCount })),
    [
      { merchantId: 'merchant-full', enrollmentStatus: 'FULL', progressVisitCount: 0 },
      { merchantId: 'merchant-new', enrollmentStatus: 'OPEN', progressVisitCount: 0 },
      { merchantId: 'merchant-visited', enrollmentStatus: 'OPEN', progressVisitCount: 1 },
    ],
  );
  assert.deepEqual(result[1]?.rewardGoals, [
    { targetVisitCount: 1, displayName: '첫 잎새' },
    { targetVisitCount: 3, displayName: '단골 새싹' },
    { targetVisitCount: 5, displayName: '월계수 관' },
  ]);
  await t.test('only the next incomplete course store receives a recommendation hint', async () => {
    const course = { id: 'course-1', title: '식사와 커피', situation: 'AFTER_MEAL',
      done: 1, total: 3, startsAt: '2026-09-01T00:00:00Z', steps: [
        { merchantId: 'merchant-visited', targetVisitCount: 1, state: 'AVAILABLE', done: true },
        { merchantId: 'merchant-new', targetVisitCount: 1, state: 'AVAILABLE', done: false },
        { merchantId: 'merchant-full', targetVisitCount: 1, state: 'AVAILABLE', done: false },
      ] } as CourseView;
    const reader = new PostgresRecommendationSource(pool, () => new Date('2026-09-19T04:00:00Z'),
      { list: async accountId => { assert.equal(accountId, 'customer-1'); return [course]; } });
    const candidates = await reader.listCandidates('customer-1');
    assert.deepEqual(candidates.find(item => item.merchantId === 'merchant-new')?.courseHint,
      { courseId: 'course-1', title: '식사와 커피', situation: 'AFTER_MEAL', done: 1, total: 3 });
    assert.equal(candidates.find(item => item.merchantId === 'merchant-visited')?.courseHint, undefined);
    assert.equal(candidates.find(item => item.merchantId === 'merchant-full')?.courseHint, undefined);
  });
});
