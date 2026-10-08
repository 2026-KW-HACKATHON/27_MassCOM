import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { PostgresCoinEconomyService } from '../postgres/coin-economy.js';
import { seedHostedShowcase } from './host-seed.js';
import { seedStoreCollectibles } from './store-collectibles.js';
import { SHOWCASE_COURSE_ID } from './local-seed.js';
import { WOLGYE_COURSE_STORES } from './wolgye-seed.js';

const testUrl = process.env.TEST_SHOWCASE_HOST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try {
    const url = new URL(testUrl);
    return url.hostname === '127.0.0.1' && url.port === '55435' &&
      url.pathname === '/masscom_showcase' && url.username === 'masscom_showcase';
  } catch { return false; }
})();

test('existing A/B/C become hidden while old visit, reward, and collected coin remain readable', {
  skip: safeTestTarget ? false : 'requires a newly created disposable PostgreSQL container on 127.0.0.1:55435',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ('showcase-local-merchant', '가상 점포 A',
               '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.',
               '시연용 가상 위치 · 실제 방문 불가', 0, 'ACTIVE', true)`,
    );
    await pool.query(
      `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public,
        enrollment_capacity, enrolled_count)
       VALUES ('showcase-local-campaign', 'showcase-local-merchant', '체험 방문 도감',
               now() - interval '1 day', now() + interval '30 days', 'ACTIVE', true, 20, 2)`,
    );
    for (const [count, name] of [
      [1, '가상 첫 방문 수집품'], [3, '가상 세 번째 방문 수집품'], [5, '가상 다섯 번째 방문 수집품'],
    ] as const) {
      await pool.query(
        'INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1, $2, $3)',
        ['showcase-local-campaign', count, name],
      );
    }
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ('showcase-local-merchant', 'disposable-staff', 'STAFF', 'ACTIVE')`,
    );
    for (const [suffix, name] of [['b', '가상 점포 B'], ['c', '가상 점포 C']]) {
      await pool.query(
        `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
         VALUES ($1, $2, '기존 시연 점포', '시연 주소', 0, 'ACTIVE', true)`,
        [`showcase-local-merchant-${suffix}`, name],
      );
      await pool.query(
        `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public,
          enrollment_capacity) VALUES ($1, $2, '체험 방문 도감', now() - interval '1 day',
          now() + interval '30 days', 'ACTIVE', true, 20)`,
        [`showcase-local-campaign-${suffix}`, `showcase-local-merchant-${suffix}`],
      );
    }
    const oldCourseId = '4b66a421-522a-4966-98cb-e359413cf412';
    await pool.query(
      `INSERT INTO courses (id, title, situation, scene_key, status, curated_by_account_id,
        checked_at, check_summary) VALUES ($1, '가상 점포 산책', 'AFTER_MEAL',
        'showcase-picnic', 'DRAFT', 'showcase-fixture', now(), '{}'::jsonb)`, [oldCourseId]);
    for (const [position, suffix] of [[1, ''], [2, '-b'], [3, '-c']] as const) {
      await pool.query(
        `INSERT INTO course_steps (course_id, position, merchant_id, piece_key, piece_label,
          owner_optin_ref, owner_optin_at) VALUES ($1, $2, $3, $4, $5, 'SHOWCASE-DEMO-ONLY', now())`,
        [oldCourseId, position, `showcase-local-merchant${suffix}`, `piece-${position}`, `조각 ${position}`]);
    }
    await pool.query("UPDATE courses SET status = 'ACTIVE' WHERE id = $1", [oldCourseId]);
    await pool.query(
      `INSERT INTO course_unlocks (account_id, course_id, evidence)
       VALUES ('disposable-customer', $1, '{}'::jsonb)`, [oldCourseId]);
    const artClient = await pool.connect();
    try {
      await artClient.query('BEGIN');
      await seedStoreCollectibles(artClient, [{ merchantId: 'showcase-local-merchant',
        campaignId: 'showcase-local-campaign', storeName: '가상 점포 A', art: 'a' }], new Date());
      await artClient.query('COMMIT');
    } catch (error) {
      await artClient.query('ROLLBACK');
      throw error;
    } finally { artClient.release(); }
    await pool.query(
      `INSERT INTO claim_slots
       (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
        token_hash, status, expires_at, claimed_at)
       VALUES ('55555555-5555-4555-8555-555555555555', 'showcase-local-merchant',
               'disposable-customer', $1, 'disposable-staff', $2, 'CLAIMED',
               now() + interval '1 hour', now())`,
      [Buffer.alloc(32, 5), Buffer.alloc(32, 6)],
    );
    await pool.query(
      `INSERT INTO visit_events
       (id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
        occurred_at, business_date, verification_level, status, progress_counted)
       VALUES ('66666666-6666-4666-8666-666666666666',
               '55555555-5555-4555-8555-555555555555', 'showcase-local-merchant',
               'showcase-local-campaign', 'disposable-customer', now(), current_date,
               'MERCHANT_CONFIRMED', 'VALID', true)`,
    );
    await pool.query(
      `INSERT INTO reward_entitlements
       (id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
        status, policy_version, earned_at, claim_expires_at)
       VALUES ('77777777-7777-4777-8777-777777777777', 'disposable-customer',
               'showcase-local-campaign', 1, '66666666-6666-4666-8666-666666666666',
               'GRANTED', 'test-policy', now(), now() + interval '1 day')`,
    );
    const beforeVisit = await pool.query(
      `SELECT to_jsonb(v) AS snapshot FROM visit_events v
       WHERE id = '66666666-6666-4666-8666-666666666666'`,
    );
    const beforeReward = await pool.query(
      `SELECT to_jsonb(r) AS snapshot FROM reward_entitlements r
       WHERE id = '77777777-7777-4777-8777-777777777777'`,
    );
    const coinService = new PostgresCoinEconomyService(pool, { accountLifecycle: new PostgresAccountLifecycle({
      hmacSecret: 'test-only-hosted-existing-account-secret',
    }) });
    const beforeCoins = await coinService.getCollection('disposable-customer');
    assert.equal(beforeCoins.coins.length, 1);
    await pool.query(
      `INSERT INTO badge_reward_offers
       (id, milestone, merchant_id, title, detail, valid_days, status, consent_note, issued_count)
       VALUES ('88888888-8888-4888-8888-888888888888', 1, 'showcase-local-merchant',
         '기존 체험 혜택', '실제 사용 불가', 30, 'ACTIVE', '기존 시연 동의', 1)`,
    );
    await pool.query(
      `INSERT INTO badge_coupons (id, customer_account_id, milestone, offer_id, merchant_id,
        title, detail, status, issued_at, expires_at)
       VALUES ('99999999-9999-4999-8999-999999999999', 'disposable-customer', 1,
         '88888888-8888-4888-8888-888888888888', 'showcase-local-merchant',
         '기존 체험 혜택', '실제 사용 불가', 'ISSUED', now(), now() + interval '1 day')`,
    );
    const beforeCoupon = await pool.query(
      "SELECT to_jsonb(c) AS snapshot FROM badge_coupons c WHERE id = '99999999-9999-4999-8999-999999999999'",
    );
    await pool.query(
      `ALTER TABLE campaigns ADD CONSTRAINT showcase_test_reject_practice
       CHECK (id <> 'trial-showcase-practice-campaign')`,
    );
    await assert.rejects(seedHostedShowcase(pool));
    const before = await counts(pool);
    assert.deepEqual(before, [3, 3, 3, 1, 1, 1]);
    await pool.query('ALTER TABLE campaigns DROP CONSTRAINT showcase_test_reject_practice');
    await seedHostedShowcase(pool);
    assert.deepEqual(await counts(pool), [34, 34, 96, 1, 1, 1]);
    // 시드 전에 받은 보상권의 수집품 참조는 그대로 보존된다.
    const acquisitions = await pool.query('SELECT 1 FROM collectible_acquisitions');
    assert.equal(acquisitions.rowCount, 1);
    const publications = await pool.query('SELECT 1 FROM campaign_collectible_publications');
    assert.equal(publications.rowCount, 31);
    const afterVisit = await pool.query(
      `SELECT to_jsonb(v) AS snapshot FROM visit_events v
       WHERE id = '66666666-6666-4666-8666-666666666666'`,
    );
    const afterReward = await pool.query(
      `SELECT to_jsonb(r) AS snapshot FROM reward_entitlements r
       WHERE id = '77777777-7777-4777-8777-777777777777'`,
    );
    assert.deepEqual(afterVisit.rows, beforeVisit.rows);
    assert.deepEqual(afterReward.rows, beforeReward.rows);
    const afterCoupon = await pool.query(
      "SELECT to_jsonb(c) AS snapshot FROM badge_coupons c WHERE id = '99999999-9999-4999-8999-999999999999'",
    );
    assert.deepEqual(afterCoupon.rows, beforeCoupon.rows);
    assert.deepEqual((await pool.query<{ status: string; issued_count: number }>(
      "SELECT status, issued_count FROM badge_reward_offers WHERE id = '88888888-8888-4888-8888-888888888888'"
    )).rows[0], { status: 'PAUSED', issued_count: 1 });
    assert.deepEqual((await coinService.getCollection('disposable-customer')).coins, beforeCoins.coins);
    const retired = await pool.query<{ id: string; status: string; published_at: Date | null }>(
      "SELECT id, status, published_at FROM merchants WHERE id LIKE 'showcase-local-merchant%' ORDER BY id");
    assert.deepEqual(retired.rows.map((row) => [row.id, row.status, row.published_at]), [
      ['showcase-local-merchant', 'PAUSED', null],
      ['showcase-local-merchant-b', 'PAUSED', null],
      ['showcase-local-merchant-c', 'PAUSED', null],
    ]);
    const campaigns = await pool.query<{ status: string; is_public: boolean }>(
      "SELECT status, is_public FROM campaigns WHERE id LIKE 'showcase-local-campaign%' ORDER BY id");
    assert.deepEqual(campaigns.rows, Array.from({ length: 3 }, () => ({ status: 'ENDED', is_public: false })));
    const course = await pool.query<{ merchant_id: string }>(
      'SELECT merchant_id FROM course_steps WHERE course_id = $1 ORDER BY position', [SHOWCASE_COURSE_ID]);
    assert.deepEqual(course.rows.map((row) => row.merchant_id), WOLGYE_COURSE_STORES.map((store) => store.id));
    assert.equal((await pool.query<{ status: string }>('SELECT status FROM courses WHERE id = $1',
      [oldCourseId])).rows[0]?.status, 'ENDED');
    assert.equal((await pool.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM course_unlocks WHERE course_id = $1', [oldCourseId]))
      .rows[0]?.total, 1);
    await seedHostedShowcase(pool);
    assert.deepEqual((await coinService.getCollection('disposable-customer')).coins, beforeCoins.coins);
    const progress = await pool.query<{ enrolled_count: number }>(
      `SELECT enrolled_count FROM campaigns WHERE id = 'showcase-local-campaign'`,
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);
  } finally {
    await pool.end();
  }
});

async function counts(pool: Pool): Promise<number[]> {
  const tables = [
    'merchants', 'campaigns', 'campaign_goals', 'claim_slots', 'visit_events', 'reward_entitlements',
  ] as const;
  const results = await Promise.all(tables.map((table) =>
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${table}`)));
  return results.map(({ rows }) => rows[0]?.total ?? -1);
}
