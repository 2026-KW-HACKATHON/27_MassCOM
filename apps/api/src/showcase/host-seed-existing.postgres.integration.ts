import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import { seedHostedShowcase } from './host-seed.js';

const testUrl = process.env.TEST_SHOWCASE_HOST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try {
    const url = new URL(testUrl);
    return url.hostname === '127.0.0.1' && url.port === '55435' &&
      url.pathname === '/masscom_showcase' && url.username === 'masscom_showcase';
  } catch { return false; }
})();

test('A-only hosted visit survives B/C expansion and a failed B insertion rolls back', {
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
    await pool.query(
      `ALTER TABLE campaigns ADD CONSTRAINT showcase_test_reject_b
       CHECK (id <> 'showcase-local-campaign-b')`,
    );
    await assert.rejects(seedHostedShowcase(pool));
    const before = await counts(pool);
    assert.deepEqual(before, [1, 1, 3, 1, 1, 1]);
    await pool.query('ALTER TABLE campaigns DROP CONSTRAINT showcase_test_reject_b');
    await seedHostedShowcase(pool);
    assert.deepEqual(await counts(pool), [3, 3, 9, 1, 1, 1]);
    // #322: 시드 전에 받은 보상권은 소급되지 않아 수집품 획득 행이 없고, 게시물은 A·B·C 캠페인에 하나씩 붙는다.
    const acquisitions = await pool.query('SELECT 1 FROM collectible_acquisitions');
    assert.equal(acquisitions.rowCount, 0);
    const publications = await pool.query('SELECT 1 FROM campaign_collectible_publications');
    assert.equal(publications.rowCount, 3);
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
