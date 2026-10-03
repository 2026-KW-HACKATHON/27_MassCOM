import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { PostgresAdminFunnelService } from './postgres/admin-funnel.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl !== undefined && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';

async function setup(t: TestContext, at = '2026-10-03T14:59:59Z') {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  return { pool, service: new PostgresAdminFunnelService(pool, () => new Date(at)) };
}

async function merchant(pool: Pool, id: string, demo = false) {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, $2, '', '서울 노원구 월계로 1', 0, 'ACTIVE', $3)`, [id, id, demo],
  );
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $1, '시험', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 50)`, [id],
  );
  await pool.query(`INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1, 1, '첫 방문')`, [id]);
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ($1, $2, 'STAFF', 'ACTIVE')`, [id, `staff-${id}`],
  );
}

async function visit(pool: Pool, id: string, customer: string, date: string, options: {
  counted?: boolean; canceled?: boolean; self?: boolean;
} = {}): Promise<string> {
  const slot = randomUUID();
  const eventId = randomUUID();
  const at = `${date}T03:00:00Z`;
  if (options.self) {
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ($1, $2, 'STAFF', 'ACTIVE') ON CONFLICT (merchant_id, account_id) DO NOTHING`, [id, customer],
    );
  }
  await pool.query(
    `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes', $7,
       $7::timestamptz - interval '5 minutes', $7)`,
    [slot, id, customer, randomBytes(32), options.self ? customer : `staff-${id}`, randomBytes(32), at],
  );
  await pool.query(
    `INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at,
       business_date, verification_level, status, progress_counted, cancellation_reason)
     VALUES ($1, $2, $3, $3, $4, $5, $6, 'MERCHANT_CONFIRMED', $7, $8, $9)`,
    [eventId, slot, id, customer, at, date, options.canceled ? 'CANCELED' : 'VALID', options.counted ?? !options.canceled,
      options.canceled ? 'WRONG_CUSTOMER' : null],
  );
  return eventId;
}

test('real-store funnel counts first visits, second stores, distinct repeaters and activity windows', { skip }, async t => {
  const { pool, service } = await setup(t);
  await merchant(pool, 'a');
  await merchant(pool, 'b');
  await merchant(pool, 'demo', true);
  await merchant(pool, 'trial');
  await pool.query(`INSERT INTO showcase_guest_trials (account_id, merchant_id, client_key_hash, expires_at)
                    VALUES ('trial-customer', 'trial', $1, '2027-01-01T00:00:00Z')`, [randomBytes(32)]);
  // old는 창 이전부터 방문했다. new는 창 안에서 두 가게를 방문하고 a에서 다른 날짜에 재방문한다.
  await visit(pool, 'a', 'old', '2026-08-01');
  await visit(pool, 'a', 'old', '2026-09-04');
  await visit(pool, 'a', 'old', '2026-10-03');
  const firstVisit = await visit(pool, 'a', 'new', '2026-09-04');
  await visit(pool, 'a', 'new', '2026-10-03');
  await visit(pool, 'b', 'new', '2026-10-02');
  await visit(pool, 'b', 'new', '2026-10-03');
  await visit(pool, 'b', 'new', '2026-10-03', { counted: false });
  await visit(pool, 'b', 'one', '2026-10-03');
  await visit(pool, 'b', 'bad', '2026-10-03', { counted: false });
  await visit(pool, 'b', 'bad', '2026-10-02', { canceled: true });
  await visit(pool, 'b', 'bad', '2026-10-01', { self: true });
  await visit(pool, 'demo', 'demo-customer', '2026-10-03');
  await visit(pool, 'trial', 'trial-customer', '2026-10-03');
  await pool.query(`INSERT INTO merchant_detail_view_counts (merchant_id, business_date, source, views) VALUES
    ('a', '2026-09-04', 'list', 3), ('a', '2026-10-03', 'map', 2),
    ('b', '2026-09-03', 'link', 9), ('demo', '2026-10-03', 'list', 7)`);
  const offer = randomUUID();
  await pool.query(`INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, status, consent_note)
                    VALUES ($1, 1, 'a', '음료', '', 30, 'PAUSED', '시험')`, [offer]);
  await pool.query(`INSERT INTO badge_coupons (id, customer_account_id, milestone, offer_id, merchant_id,
    title, detail, status, issued_at, expires_at, redeemed_at, redeemed_by_account_id) VALUES
    ($1, 'new', 1, $2, 'a', '음료', '', 'REDEEMED', '2026-09-04T00:00:00Z', '2027-01-01T00:00:00Z',
     '2026-10-03T14:00:00Z', 'staff-a')`, [randomUUID(), offer]);
  const project = randomUUID();
  const publication = randomUUID();
  const entitlement = randomUUID();
  await pool.query(`INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, 'a', $1)`, [project]);
  await pool.query(`INSERT INTO collectible_publications
    (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
    VALUES ($1, $2, 'a', 'a', 1, '{"1":"bronze"}'::jsonb)`, [publication, project]);
  await pool.query(`INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail)
                    VALUES ($1, 'bronze', '{}'::jsonb, '{}'::jsonb)`, [publication]);
  await pool.query(`INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count,
    source_visit_event_id, status, policy_version, earned_at, claim_expires_at)
    VALUES ($1, 'new', 'a', 1, $2, 'GRANTED', 'TEST', '2026-09-04T03:00:00Z', '2027-01-01T00:00:00Z')`,
    [entitlement, firstVisit]);
  await pool.query(`INSERT INTO collectible_acquisitions (entitlement_id, publication_id, grade_id, acquired_at)
                    VALUES ($1, $2, 'bronze', '2026-10-03T14:00:00Z')`, [entitlement, publication]);
  const funnel = await service.funnel(30);
  assert.equal(funnel.from, '2026-09-04');
  assert.equal(funnel.to, '2026-10-03');
  assert.deepEqual(funnel.totals, {
    detailViews: 5, countedVisits: 7, newVisitors: 2, newVisitorsWithSecondStore: 1, repeatVisitors: 2,
  });
  assert.deepEqual(funnel.merchants, [
    { merchantId: 'a', name: 'a', detailViews: 5, countedVisits: 4, uniqueVisitors: 2, repeatVisitors: 2,
      couponsIssued: 1, couponsRedeemed: 1, collectiblesAcquired: 1 },
    { merchantId: 'b', name: 'b', detailViews: 0, countedVisits: 3, uniqueVisitors: 2, repeatVisitors: 1,
      couponsIssued: 0, couponsRedeemed: 0, collectiblesAcquired: 0 },
  ]);
});

test('KST midnight moves the window; invalid day ranges are rejected', { skip }, async t => {
  const { pool } = await setup(t);
  await merchant(pool, 'a');
  await visit(pool, 'a', 'one', '2026-10-03');
  const before = new PostgresAdminFunnelService(pool, () => new Date('2026-10-03T14:59:59Z'));
  const after = new PostgresAdminFunnelService(pool, () => new Date('2026-10-03T15:00:00Z'));
  assert.equal((await before.funnel(7)).to, '2026-10-03');
  assert.equal((await after.funnel(7)).to, '2026-10-04');
  assert.equal((await after.funnel(7)).totals.countedVisits, 1);
  await assert.rejects(after.funnel(6), RangeError);
  await assert.rejects(after.funnel(91), RangeError);
});
