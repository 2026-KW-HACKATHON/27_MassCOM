import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';

import { CampaignBenefitError } from './campaign-benefits.js';
import { PostgresCampaignBenefitService } from './postgres/campaign-benefits.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTarget ? false : 'requires a disposable _test PostgreSQL database';

async function world(t: TestContext, purpose: 'NEW_CUSTOMERS' | 'REVISIT' | 'OFF_PEAK' | null = 'NEW_CUSTOMERS') {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  const merchantId = randomUUID();
  const campaignId = randomUUID();
  const adminAccountId = `admin-${randomUUID()}`;
  const staffId = `staff-${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES ('google',$1,$2,now())`, [randomUUID(), adminAccountId]);
  await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminAccountId]);
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ($1,'혜택 점포','','서울',0,'ACTIVE',false)`, [merchantId]);
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
    VALUES ($1,$2,'STAFF','ACTIVE')`, [merchantId, staffId]);
  await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ($1,$2,'혜택 캠페인',now()-interval '1 day',now()+interval '30 days','DRAFT',false,100)`,
    [campaignId, merchantId]);
  if (purpose) await pool.query(`INSERT INTO campaign_purposes(campaign_id,purpose,time_windows)
    VALUES ($1,$2,$3::jsonb)`, [campaignId, purpose,
    purpose === 'OFF_PEAK' ? JSON.stringify([{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '24:00' }]) : null]);
  await pool.query(`UPDATE campaigns SET status='ACTIVE',is_public=true WHERE id=$1`, [campaignId]);
  const service = new PostgresCampaignBenefitService(pool);
  const create = (maxUses = 2, unitExtraCostWon = 10_000, validDays = 30) => service.createBenefit({
    adminAccountId, campaignId, title: '한 잔 혜택', detail: '다음 방문에 사용', validDays,
    unitExtraCostWon, maxUses, consentDocumentRef: `consent-${randomUUID().slice(0, 4)}a${randomUUID().slice(0, 4)}`,
    consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true },
  });
  async function visit(accountId: string, businessDate?: string, occurredAt?: Date) {
    const slotId = randomUUID();
    const visitId = randomUUID();
    await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,
      created_by_account_id,token_hash,status,expires_at,claimed_at,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,'CLAIMED',coalesce($7::timestamptz,now())+interval '1 hour',
        coalesce($7::timestamptz,now()),coalesce($7::timestamptz,now())-interval '1 minute')`,
    [slotId, merchantId, accountId, randomBytes(32), staffId, randomBytes(32), occurredAt ?? null]);
    await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
      occurred_at,business_date,verification_level,status,progress_counted)
      VALUES ($1,$2,$3,$4,$5,coalesce($7::timestamptz,now()),coalesce($6::date,(now() AT TIME ZONE 'Asia/Seoul')::date),
        'MERCHANT_CONFIRMED','VALID',true)`,
    [visitId, slotId, merchantId, campaignId, accountId, businessDate ?? null, occurredAt ?? null]);
    return visitId;
  }
  return { pool, service, merchantId, campaignId, adminAccountId, create, visit };
}

test('five customers share a cap of two; eight concurrent same-account claims replay one coupon', { skip }, async t => {
  const w = await world(t);
  await assert.rejects(w.service.claimBenefit({ accountId: 'customer', benefitId: 'not-a-uuid' }),
    (error: CampaignBenefitError) => error.code === 'BENEFIT_NOT_FOUND');
  const benefit = await w.create();
  const accounts = Array.from({ length: 5 }, () => `customer-${randomUUID()}`);
  await Promise.all(accounts.map(account => w.visit(account)));
  const results = await Promise.allSettled(accounts.map(accountId => w.service.claimBenefit({ accountId, benefitId: benefit.id })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter(result => result.status === 'rejected' &&
    result.reason instanceof CampaignBenefitError && result.reason.code === 'CAP_REACHED').length, 3);
  const status = (await w.service.getBenefitStatus({ accountId: w.adminAccountId, campaignId: w.campaignId })).benefit!;
  assert.equal(status.issuedCount, 2);
  assert.equal(status.additionalIssuable, 0);
  assert.equal(status.maxExposure, '20000');
  const winner = accounts.find((_, index) => results[index]?.status === 'fulfilled')!;
  const replays = await Promise.all(Array.from({ length: 8 }, () =>
    w.service.claimBenefit({ accountId: winner, benefitId: benefit.id })));
  assert.equal(new Set(replays.map(result => result.coupon.couponId)).size, 1);
  assert.ok(replays.every(result => result.replayed));
  const count = await w.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM campaign_benefit_coupons WHERE benefit_id=$1 AND status<>'VOIDED'`, [benefit.id]);
  assert.equal(count.rows[0]?.n, status.issuedCount);
});

test('eight first claims by the same customer issue once and replay seven times', { skip }, async t => {
  const w = await world(t);
  const benefit = await w.create();
  const accountId = `customer-${randomUUID()}`;
  await w.visit(accountId);
  const results = await Promise.all(Array.from({ length: 8 }, () =>
    w.service.claimBenefit({ accountId, benefitId: benefit.id })));
  assert.equal(new Set(results.map(result => result.coupon.couponId)).size, 1);
  assert.equal(results.filter(result => !result.replayed).length, 1);
  assert.equal(results.filter(result => result.replayed).length, 7);
  assert.equal((await w.service.getBenefitStatus({ accountId: w.adminAccountId,
    campaignId: w.campaignId })).benefit?.issuedCount, 1);
});

async function waitForBlocked(pool: Pool, queryPattern: string) {
  for (let i = 0; i < 100; i++) {
    const blocked = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1) AS waiting`,
      [`%${queryPattern}%`],
    );
    if (blocked.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`claim did not reach blocked ${queryPattern} query`);
}

test('terms guard, paused claims, four numbers, and legacy campaign', { skip }, async t => {
  const w = await world(t);
  assert.deepEqual(await w.service.getBenefitStatus({ accountId: w.adminAccountId, campaignId: w.campaignId }),
    { benefit: null, benefits: [] });
  const benefit = await w.create(10_000, 1_000_000);
  const accountId = `customer-${randomUUID()}`;
  await w.visit(accountId);
  const issued = await w.service.claimBenefit({ accountId, benefitId: benefit.id });
  assert.equal(issued.coupon.status, 'ISSUED');
  await assert.rejects(w.pool.query(`UPDATE campaign_benefits SET max_uses=9999 WHERE id=$1`, [benefit.id]),
    (error: { code?: string }) => error.code === '23514');
  await assert.rejects(w.pool.query(`UPDATE campaign_benefits SET issued_count=issued_count+2 WHERE id=$1`, [benefit.id]),
    (error: { code?: string }) => error.code === '23514');
  await assert.rejects(w.pool.query(`DELETE FROM campaign_benefits WHERE id=$1`, [benefit.id]),
    (error: { code?: string }) => error.code === '23514');
  const paused = await w.service.pauseBenefit({ adminAccountId: w.adminAccountId, campaignId: w.campaignId });
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.issued, 1);
  assert.equal(paused.usable, 1);
  assert.equal(paused.promisedMaxCost, '1000000');
  assert.equal(paused.maxExposure, '10000000000');
  const another = `customer-${randomUUID()}`;
  await w.visit(another);
  await assert.rejects(w.service.claimBenefit({ accountId: another, benefitId: benefit.id }),
    (error: CampaignBenefitError) => error.code === 'BENEFIT_PAUSED');
  const listed = await w.service.listBenefits(accountId);
  assert.equal(listed.benefits[0]?.state, 'OWNED');
  assert.equal(listed.benefits[0]?.coupon?.couponId, issued.coupon.couponId);
  assert.equal(JSON.stringify(listed).includes('unitExtraCostWon'), false);
  const replacement = await w.create(2, 5_000);
  const history = await w.service.getBenefitStatus({ accountId: w.adminAccountId, campaignId: w.campaignId });
  assert.equal(history.benefit?.id, replacement.id);
  assert.deepEqual(history.benefits.map(item => ({ id: item.id, issued: item.issued })),
    [{ id: replacement.id, issued: 0 }, { id: benefit.id, issued: 1 }]);
  assert.equal((await w.service.listBenefits(accountId)).benefits[0]?.benefitId, benefit.id);
});

test('merchant hide wins a waiting claim and does not consume capacity', { skip }, async t => {
  const w = await world(t);
  const benefit = await w.create();
  const accountId = `customer-${randomUUID()}`;
  await w.visit(accountId);
  const locker = await w.pool.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(`UPDATE merchants SET status='PAUSED' WHERE id=$1`, [w.merchantId]);
    const claiming = w.service.claimBenefit({ accountId, benefitId: benefit.id });
    await waitForBlocked(w.pool, 'SELECT status FROM merchants');
    await locker.query('COMMIT');
    await assert.rejects(claiming,
      (error: CampaignBenefitError) => error.code === 'MERCHANT_NOT_ACTIVE');
    assert.equal((await w.service.getBenefitStatus({ accountId: w.adminAccountId,
      campaignId: w.campaignId })).benefit?.issuedCount, 0);
  } finally { await locker.query('ROLLBACK'); locker.release(); }
});

test('benefit pause wins a waiting claim and does not consume capacity', { skip }, async t => {
  const w = await world(t);
  const benefit = await w.create();
  const accountId = `customer-${randomUUID()}`;
  await w.visit(accountId);
  const locker = await w.pool.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(`UPDATE campaign_benefits SET status='PAUSED' WHERE id=$1`, [benefit.id]);
    const claiming = w.service.claimBenefit({ accountId, benefitId: benefit.id });
    await waitForBlocked(w.pool, 'UPDATE campaign_benefits SET issued_count');
    await locker.query('COMMIT');
    await assert.rejects(claiming,
      (error: CampaignBenefitError) => error.code === 'BENEFIT_PAUSED');
    assert.equal((await w.service.getBenefitStatus({ accountId: w.adminAccountId,
      campaignId: w.campaignId })).benefit?.issuedCount, 0);
  } finally { await locker.query('ROLLBACK'); locker.release(); }
});

test('revisit coupon claimed long after qualifying visit retains a usable validity window', { skip }, async t => {
  const w = await world(t, 'REVISIT');
  await w.pool.query(`UPDATE campaigns SET starts_at=now()-interval '20 days' WHERE id=$1`, [w.campaignId]);
  const benefit = await w.create(2, 1000, 1);
  const accountId = `customer-${randomUUID()}`;
  const dates = (await w.pool.query<{ first: string; second: string }>(
    `SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date - 10)::text AS first,
      ((now() AT TIME ZONE 'Asia/Seoul')::date - 8)::text AS second`)).rows[0]!;
  await w.visit(accountId, dates.first, new Date(Date.now() - 10 * 86_400_000));
  await w.visit(accountId, dates.second, new Date(Date.now() - 8 * 86_400_000));
  const issued = await w.service.claimBenefit({ accountId, benefitId: benefit.id });
  assert.ok(new Date(issued.coupon.usableFrom!).getTime() < Date.now());
  assert.ok(new Date(issued.coupon.expiresAt).getTime() > Date.now());
});

test('four numbers separate redeemed, usable, expired, and voided rows', { skip }, async t => {
  const w = await world(t);
  const benefit = await w.create(4, 25_000);
  const accountIds = Array.from({ length: 4 }, () => `customer-${randomUUID()}`);
  await Promise.all(accountIds.map(accountId => w.visit(accountId)));
  const coupons = await Promise.all(accountIds.map(accountId =>
    w.service.claimBenefit({ accountId, benefitId: benefit.id })));
  await w.pool.query(`UPDATE campaign_benefit_coupons SET status='REDEEMED',redeemed_at=now(),
    redeemed_by_account_id='staff-test' WHERE id=$1`, [coupons[0]!.coupon.couponId]);
  await w.pool.query(`UPDATE campaign_benefit_coupons SET issued_at=now()-interval '3 days',
    usable_from=now()-interval '3 days',expires_at=now()-interval '2 days' WHERE id=$1`,
  [coupons[1]!.coupon.couponId]);
  await w.pool.query(`UPDATE campaign_benefit_coupons SET status='VOIDED',voided_at=now(),
    void_reason='ISSUED_IN_ERROR',voided_by_account_id='staff-test' WHERE id=$1`,
  [coupons[3]!.coupon.couponId]);
  await w.pool.query(`UPDATE campaign_benefits SET issued_count=issued_count-1 WHERE id=$1`, [benefit.id]);
  const status = (await w.service.getBenefitStatus({ accountId: w.adminAccountId,
    campaignId: w.campaignId })).benefit!;
  assert.deepEqual({ issued: status.issued, redeemed: status.redeemed, usable: status.usable,
    expiredUnused: status.expiredUnused, additionalIssuable: status.additionalIssuable,
    issuedCount: status.issuedCount, costBorne: status.costBorne,
    maxExposure: status.maxExposure, promisedMaxCost: status.promisedMaxCost },
  { issued: 3, redeemed: 1, usable: 1, expiredUnused: 1, additionalIssuable: 1,
    issuedCount: 3, costBorne: '25000', maxExposure: '100000', promisedMaxCost: '50000' });
});
