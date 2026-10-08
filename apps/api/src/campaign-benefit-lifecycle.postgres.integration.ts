import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresCampaignBenefitService } from './postgres/campaign-benefits.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresReversalService } from './postgres/reversal.js';

const testUrl = process.env.TEST_DATABASE_URL;
const skip = testUrl && decodeURIComponent(new URL(testUrl).pathname).endsWith('_test')
  ? false : 'requires a disposable _test PostgreSQL database';
const now = new Date('2026-10-08T03:00:00.000Z');
const hmacSecret = 'campaign-benefit-test-account-secret-32-bytes';

async function setup(t: TestContext) {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE account_deletion_requests, customer_identity_tokens, merchants CASCADE');
  await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status, is_demo)
    VALUES ('benefit-shop', '혜택 시험점', '', '서울', 0, 'ACTIVE', false)`);
  await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ('benefit-campaign', 'benefit-shop', '혜택 시험', '2026-01-01', '2027-01-01', 'DRAFT', false, 10)`);
  await pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose)
    VALUES ('benefit-campaign', 'NEW_CUSTOMERS')`);
  await pool.query(`UPDATE campaigns SET status = 'ACTIVE', is_public = true WHERE id = 'benefit-campaign'`);
  await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
    VALUES ('benefit-shop', 'benefit-staff', 'STAFF', 'ACTIVE')`);
  const benefitId = randomUUID();
  await pool.query(`INSERT INTO campaign_benefits(id, campaign_id, merchant_id, title, detail,
    valid_days, unit_extra_cost_won, max_uses, status, consent_document_ref, consent_checklist_version)
    VALUES ($1, 'benefit-campaign', 'benefit-shop', '음료', '방문 혜택', 7, 1500, 1, 'ACTIVE',
      'benefit-test-ref', 'owner-offer-consent-v1')`, [benefitId]);
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  const state = { now };
  const clock = () => state.now;
  return {
    pool, benefitId, state,
    benefits: new PostgresCampaignBenefitService(pool, { now: clock, accountLifecycle: lifecycle }),
    badges: new PostgresBadgeRewardService(pool, { now: clock, accountLifecycle: lifecycle }),
    identities: new PostgresCustomerIdentityService(pool, { now: clock, accountLifecycle: lifecycle }),
    reversal: new PostgresReversalService(pool, { now: clock, accountLifecycle: lifecycle,
      labelHmacSecret: 'campaign-benefit-test-label-secret-32-bytes' }),
    deletion: new PostgresAccountDeletionService(pool, { now: clock, accountLifecycle: lifecycle,
      hmacSecret, policyVersion: 'account-deletion-v1' }),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

async function addVisit(db: Db, customer: string) {
  const slotId = randomUUID();
  const visitId = randomUUID();
  await db.pool.query(`INSERT INTO claim_slots(id, merchant_id, customer_account_id,
    merchant_reference_hash, created_by_account_id, token_hash, status, expires_at,
    claimed_at, created_at, updated_at)
    VALUES ($1, 'benefit-shop', $2, $3, 'benefit-staff', $4, 'CLAIMED',
      $5::timestamptz + interval '15 minutes', $5, $5, $5)`,
  [slotId, customer, randomBytes(32), randomBytes(32), now]);
  await db.pool.query(`INSERT INTO visit_events(id, claim_slot_id, merchant_id, campaign_id,
    customer_account_id, occurred_at, business_date, verification_level, status, progress_counted)
    VALUES ($1, $2, 'benefit-shop', 'benefit-campaign', $3, $4, '2026-10-08',
      'MERCHANT_CONFIRMED', 'VALID', true)`, [visitId, slotId, customer, now]);
  return visitId;
}

async function addCoupon(db: Db, customer: string, usableFrom = now) {
  const visitId = await addVisit(db, customer);
  const couponId = randomUUID();
  await db.pool.query(`INSERT INTO campaign_benefit_coupons(id, benefit_id, campaign_id, merchant_id,
    customer_account_id, title, detail, unit_extra_cost_won, source_visit_event_id,
    status, issued_at, usable_from, expires_at)
    VALUES ($1, $2, 'benefit-campaign', 'benefit-shop', $3, '음료', '방문 혜택', 1500, $4,
      'ISSUED', $5, $6, $5::timestamptz + interval '7 days')`,
  [couponId, db.benefitId, customer, visitId, now, usableFrom]);
  await db.pool.query('UPDATE campaign_benefits SET issued_count = issued_count + 1 WHERE id = $1', [db.benefitId]);
  return { couponId, visitId };
}

async function tokenFor(db: Db, customer: string) {
  const created = await db.identities.create(customer);
  await db.identities.resolve({ token: created.token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff' });
  return created.token;
}

test('a coupon remains redeemable at the cap, is listed with existing staff shape, and can be undone within ten minutes', { skip }, async (t) => {
  const db = await setup(t);
  const { couponId, visitId } = await addCoupon(db, 'benefit-customer');
  const token = await tokenFor(db, 'benefit-customer');
  const lookedUp = await db.badges.lookupCoupons({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff' });
  assert.deepEqual(lookedUp.coupons, [{ couponId, title: '음료', detail: '방문 혜택',
    expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString() }]);
  assert.equal((await db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId })).replayed, false);
  assert.equal((await db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId })).replayed, true);
  assert.equal((await db.reversal.listRecentCouponRedemptions({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff' })).coupons[0]?.couponId, couponId);
  assert.deepEqual(await db.reversal.undoCouponRedemption({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId }),
    { couponId, status: 'ISSUED', replayed: false });
  await db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId });
  await assert.rejects(db.reversal.cancelVisit({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff',
    visitEventId: visitId, reason: 'WRONG_CUSTOMER' }), { code: 'VISIT_REWARD_COUPON_REDEEMED' });
  db.state.now = new Date(now.getTime() + 10 * 60000 + 1);
  await assert.rejects(db.reversal.undoCouponRedemption({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId }),
    { code: 'COUPON_UNDO_WINDOW_CLOSED' });
  assert.equal((await db.pool.query<{ issued_count: number }>('SELECT issued_count FROM campaign_benefits WHERE id = $1', [db.benefitId])).rows[0]?.issued_count, 1);
});

test('usable_from blocks early redemption and a canceled visit voids the coupon and releases capacity', { skip }, async (t) => {
  const db = await setup(t);
  const { couponId, visitId } = await addCoupon(db, 'benefit-customer', new Date(now.getTime() + 86400000));
  const token = await tokenFor(db, 'benefit-customer');
  assert.deepEqual((await db.badges.lookupCoupons({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff' })).coupons, []);
  await assert.rejects(db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId }),
    { code: 'COUPON_NOT_YET_USABLE' });
  const canceled = await db.reversal.cancelVisit({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff',
    visitEventId: visitId, reason: 'WRONG_CUSTOMER' });
  assert.equal(canceled.voidedCouponCount, 1);
  assert.deepEqual((await db.pool.query<{ status: string; void_reason: string }>(
    'SELECT status, void_reason FROM campaign_benefit_coupons WHERE id = $1', [couponId])).rows[0],
  { status: 'VOIDED', void_reason: 'VISIT_CANCELED' });
  assert.equal((await db.pool.query<{ issued_count: number }>('SELECT issued_count FROM campaign_benefits WHERE id = $1', [db.benefitId])).rows[0]?.issued_count, 0);
  const next = await addCoupon(db, 'benefit-customer');
  assert.notEqual(next.couponId, couponId);
  const reconciled = (await db.pool.query<{ issued_count: number; live_count: number }>(
    `SELECT benefit.issued_count,
      (SELECT count(*)::integer FROM campaign_benefit_coupons AS coupon
       WHERE coupon.benefit_id = benefit.id AND coupon.status <> 'VOIDED') AS live_count
     FROM campaign_benefits AS benefit WHERE benefit.id = $1`, [db.benefitId])).rows[0]!;
  assert.deepEqual(reconciled, { issued_count: 1, live_count: 1 });
  assert.equal((await db.reversal.cancelVisit({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff',
    visitEventId: visitId, reason: 'WRONG_CUSTOMER' })).replayed, true);
  await db.deletion.requestDeletion({ accountId: 'benefit-staff', confirmation: 'DELETE MY ACCOUNT' });
  assert.match((await db.pool.query<{ voided_by_account_id: string }>(
    'SELECT voided_by_account_id FROM campaign_benefit_coupons WHERE id = $1', [couponId])).rows[0]!.voided_by_account_id, /^deleted:/);
});

test('customer claim can use capacity released by cancellation of its source visit', { skip }, async (t) => {
  const db = await setup(t);
  const firstVisit = await addVisit(db, 'benefit-customer');
  const first = await db.benefits.claimBenefit({ accountId: 'benefit-customer', benefitId: db.benefitId });
  assert.equal(first.replayed, false);
  await db.reversal.cancelVisit({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff',
    visitEventId: firstVisit, reason: 'WRONG_CUSTOMER' });
  const nextVisit = await addVisit(db, 'benefit-customer');
  const next = await db.benefits.claimBenefit({ accountId: 'benefit-customer', benefitId: db.benefitId });
  assert.equal(next.replayed, false);
  assert.notEqual(next.coupon.couponId, first.coupon.couponId);
  assert.equal((await db.benefits.claimBenefit({ accountId: 'benefit-customer', benefitId: db.benefitId })).replayed, true);
  const rows = (await db.pool.query<{ id: string; status: string; source_visit_event_id: string }>(
    `SELECT id,status,source_visit_event_id FROM campaign_benefit_coupons
     WHERE benefit_id=$1 ORDER BY issued_at,id`, [db.benefitId])).rows;
  assert.deepEqual(rows.map(row => [row.id, row.status, row.source_visit_event_id]).sort(),
    [[first.coupon.couponId, 'VOIDED', firstVisit], [next.coupon.couponId, 'ISSUED', nextVisit]].sort());
  assert.equal((await db.pool.query<{ issued_count: number }>(
    'SELECT issued_count FROM campaign_benefits WHERE id=$1', [db.benefitId])).rows[0]?.issued_count, 1);
});

test('a claim racing its source visit cancellation cannot leave a live coupon', { skip }, async (t) => {
  const db = await setup(t);
  const visitId = await addVisit(db, 'benefit-customer');
  const locker = await db.pool.connect();
  try {
    await locker.query('BEGIN');
    await locker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      ['campaign-benefit:benefit-customer:benefit-campaign']);
    const claim = db.benefits.claimBenefit({ accountId: 'benefit-customer', benefitId: db.benefitId });
    // Claim reaches the advisory key first; cancel then waits for its account lock.
    for (let attempt = 0; attempt < 100; attempt++) {
      const blocked = (await db.pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM pg_stat_activity
         WHERE wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'`,
      )).rows[0]!.count;
      if (blocked >= 1) break;
      if (attempt === 99) throw new Error('claim did not wait for campaign benefit lock');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const cancel = db.reversal.cancelVisit({ merchantId: 'benefit-shop', staffAccountId: 'benefit-staff',
      visitEventId: visitId, reason: 'WRONG_CUSTOMER' });
    await locker.query('COMMIT');
    const outcomes = await Promise.allSettled([claim, cancel]);
    assert.equal(outcomes[1]?.status, 'fulfilled');
    const state = (await db.pool.query<{ issued_count: number; live: number }>(
      `SELECT benefit.issued_count,
         (SELECT count(*)::integer FROM campaign_benefit_coupons AS coupon
          WHERE coupon.benefit_id=benefit.id AND coupon.status <> 'VOIDED') AS live
       FROM campaign_benefits AS benefit WHERE benefit.id=$1`, [db.benefitId])).rows[0]!;
    assert.deepEqual(state, { issued_count: 0, live: 0 });
    assert.equal((await db.pool.query<{ status: string }>(
      'SELECT status FROM visit_events WHERE id=$1', [visitId])).rows[0]?.status, 'CANCELED');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
  }
});

test('a real-store staff member cannot redeem their own benefit coupon', { skip }, async (t) => {
  const db = await setup(t);
  const { couponId } = await addCoupon(db, 'benefit-staff');
  const token = await tokenFor(db, 'benefit-staff');
  await assert.rejects(db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId }),
    { code: 'COUPON_SELF_REDEEM' });
});

test('an expired benefit coupon is absent from lookup and cannot redeem', { skip }, async (t) => {
  const db = await setup(t);
  const { couponId } = await addCoupon(db, 'benefit-customer');
  db.state.now = new Date(now.getTime() + 8 * 86400000);
  const token = await tokenFor(db, 'benefit-customer');
  assert.deepEqual((await db.badges.lookupCoupons({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff' })).coupons, []);
  await assert.rejects(db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId }),
    { code: 'COUPON_EXPIRED' });
});

test('deletion pseudonymizes customer and staff references without deleting benefit coupons', { skip }, async (t) => {
  const db = await setup(t);
  const { couponId } = await addCoupon(db, 'benefit-customer');
  const token = await tokenFor(db, 'benefit-customer');
  await db.badges.redeemCoupon({ token, merchantId: 'benefit-shop', staffAccountId: 'benefit-staff', couponId });
  await db.deletion.requestDeletion({ accountId: 'benefit-customer', confirmation: 'DELETE MY ACCOUNT' });
  await db.deletion.requestDeletion({ accountId: 'benefit-staff', confirmation: 'DELETE MY ACCOUNT' });
  const row = (await db.pool.query<{ customer_account_id: string; redeemed_by_account_id: string }>(
    'SELECT customer_account_id, redeemed_by_account_id FROM campaign_benefit_coupons WHERE id = $1', [couponId])).rows[0]!;
  assert.match(row.customer_account_id, /^deleted:/);
  assert.match(row.redeemed_by_account_id, /^deleted:/);
  assert.notEqual(row.customer_account_id, row.redeemed_by_account_id);
});
