import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { BadgeRewardError } from './badge-rewards.js';
import { MerchantAccessError } from './merchant-access.js';
import { MintRequestError } from './mint-request-service.js';
import { ReversalError } from './reversal.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { AdminError, PostgresAdminService } from './postgres/admin.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresReversalService } from './postgres/reversal.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
const labelSecret = 'test-only-customer-label-secret-at-least-32-bytes';
// real-shop·other-shop만 실제 점포(is_demo = false)이고 demo-shop은 시연 점포다.
const staffOf = { 'real-shop': 'staff-r', 'other-shop': 'staff-o', 'demo-shop': 'staff-d' } as const;
type Shop = keyof typeof staffOf;
const today = '2026-09-30';

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    'TRUNCATE account_deletion_requests, customer_identity_tokens, wallet_bindings, platform_admins, auth_identities, merchants CASCADE',
  );
  for (const [shop, staff] of Object.entries(staffOf)) {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', $3)`,
      [shop, `시험 ${shop}`, shop === 'demo-shop'],
    );
    await pool.query(
      `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
       VALUES ($1, $2, 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 50)`,
      [`campaign-${shop}`, shop],
    );
    await pool.query(
      `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
       VALUES ($1, 1, '1회'), ($1, 3, '3회'), ($1, 5, '5회')`,
      [`campaign-${shop}`],
    );
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
      [shop, staff],
    );
  }
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ('real-shop', 'staff-r2', 'STAFF', 'ACTIVE')`,
  );
  for (const target of [1, 3, 5]) {
    await pool.query(
      `INSERT INTO nft_series (id, campaign_id, target_visit_count, chain_id, contract_address,
         contract_address_normalized, series_key, max_ever_minted, status)
       VALUES ($1, 'campaign-real-shop', $2, 31337, '0x7000000000000000000000000000000000000007',
         '0x7000000000000000000000000000000000000007', decode(repeat($3, 32), 'hex'), 10, 'ACTIVE')`,
      [`series-${target}`, target, `a${target}`],
    );
  }
  const state = { now: new Date(`${today}T03:00:00.000Z`) };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  return {
    pool, state, lifecycle,
    reversal: new PostgresReversalService(pool, { now, labelHmacSecret: labelSecret, accountLifecycle: lifecycle }),
    badges: new PostgresBadgeRewardService(pool, { now, accountLifecycle: lifecycle }),
    identities: new PostgresCustomerIdentityService(pool, { now, accountLifecycle: lifecycle }),
    claims: new PostgresClaimSlotService(pool, {
      now, referenceHmacSecret: 'test-reference-hmac-secret-32-bytes', accountLifecycle: lifecycle,
    }),
    mints: new PostgresMintRequestService(pool, {
      now, supportedConsentVersion: 'nft-mint-v1', accountLifecycle: lifecycle,
    }),
    deletion: new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', now, accountLifecycle: lifecycle,
    }),
    admin: new PostgresAdminService(pool, hmacSecret, labelSecret),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

const forbidden = (error: unknown) => error instanceof MerchantAccessError && error.code === 'MERCHANT_ACCESS_DENIED';
const reversalCode = (code: string) => (error: unknown) => error instanceof ReversalError && error.code === code;

// 방문 수령을 실제 서비스로 만든다: 점원이 QR을 발급하고 고객이 확정한다.
async function claim(db: Db, input: { account: string; shop: Shop; staff?: string; at?: string }) {
  if (input.at) db.state.now = new Date(input.at);
  const issued = await db.claims.issue({
    merchantId: input.shop,
    customerAccountId: input.account,
    merchantReference: randomUUID(),
    createdByAccountId: input.staff ?? staffOf[input.shop],
  });
  return db.claims.redeem({ accountId: input.account, token: issued.token });
}

async function cancel(db: Db, visitEventId: string, over: Partial<{
  merchantId: string; staffAccountId: string; reason: unknown; note: unknown;
}> = {}) {
  return db.reversal.cancelVisit({
    merchantId: 'real-shop', staffAccountId: 'staff-r', visitEventId, reason: 'WRONG_CUSTOMER', ...over,
  });
}

async function rows<T extends object = Record<string, unknown>>(pool: Pool, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, params)).rows;
}

async function visitState(pool: Pool, visitId: string) {
  return (await rows<{ status: string; progress_counted: boolean; cancellation_reason: string | null;
    cancellation_note: string | null; canceled_by_account_id: string | null; canceled_at: Date | null }>(
    pool,
    `SELECT status, progress_counted, cancellation_reason, cancellation_note, canceled_by_account_id, canceled_at
     FROM visit_events WHERE id = $1`, [visitId]))[0]!;
}

async function entitlementsOf(pool: Pool, account: string) {
  return rows<{ id: string; target_visit_count: number; status: string; source_visit_event_id: string;
    revoked_by_visit_event_id: string | null }>(
    pool,
    `SELECT id, target_visit_count, status, source_visit_event_id, revoked_by_visit_event_id
     FROM reward_entitlements WHERE customer_account_id = $1 ORDER BY target_visit_count, created_at, id`, [account]);
}

// 워커 없이 발행 작업을 직접 만든다. 권리를 MINT_REQUESTED로 바꾸고 outbox 행도 함께 둔다.
async function seedMintJob(pool: Pool, input: {
  entitlementId: string; account: string; target: 1 | 3 | 5; status: string; transactionHash?: string;
  lastErrorCode?: string; outbox?: 'PENDING' | 'LEASED' | 'PUBLISHED'; leaseExpiresAt?: string;
  entitlementStatus?: 'MINT_REQUESTED' | 'FULFILLED';
}): Promise<string> {
  const address = `0x${randomBytes(20).toString('hex')}`;
  const bindingId = randomUUID();
  await pool.query(
    `INSERT INTO wallet_bindings (id, account_id, address_checksum, address_normalized, chain_id, binding_version,
       status, verified_at) VALUES ($1, $2, $3, $3, 31337, 1, 'VERIFIED', now())
     ON CONFLICT DO NOTHING`,
    [bindingId, input.account, address],
  );
  const binding = (await rows<{ id: string; address_normalized: string }>(
    pool, `SELECT id, address_normalized FROM wallet_bindings WHERE account_id = $1 AND status = 'VERIFIED'`, [input.account]))[0]!;
  const jobId = randomUUID();
  await pool.query(
    `INSERT INTO mint_jobs (id, entitlement_id, account_id, nft_series_id, reward_key, wallet_binding_id, binding_version,
       recipient_address, recipient_address_normalized, chain_id, contract_address, contract_address_normalized,
       series_key, consent_version, idempotency_key, request_fingerprint, status, transaction_hash, last_error_code,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7, 31337,
       '0x7000000000000000000000000000000000000007', '0x7000000000000000000000000000000000000007',
       decode(repeat($8, 32), 'hex'), 'nft-mint-v1', $9, $10, $11, $12, $13, now(), now())`,
    [jobId, input.entitlementId, input.account, `series-${input.target}`, randomBytes(32), binding.id,
      binding.address_normalized, `a${input.target}`, `seed-${randomUUID()}`, randomBytes(32), input.status,
      input.transactionHash ?? null, input.lastErrorCode ?? null],
  );
  const outbox = input.outbox ?? 'PENDING';
  await pool.query(
    `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, status, available_at,
       lease_owner, lease_expires_at, created_at, updated_at)
     VALUES ($1, 'MINT_JOB', $2, 'MINT_REQUESTED', $3, $4, now() - interval '1 hour', $5, $6, now(), now())`,
    [randomUUID(), jobId, { jobId }, outbox, outbox === 'LEASED' ? 'worker-1' : null,
      outbox === 'LEASED' ? input.leaseExpiresAt ?? `${today}T03:30:00Z` : null],
  );
  await pool.query(`UPDATE reward_entitlements SET status = $2 WHERE id = $1`,
    [input.entitlementId, input.entitlementStatus ?? 'MINT_REQUESTED']);
  return jobId;
}

const txHash = `0x${'ab'.repeat(32)}`;

// 실제 점포 방문 수령 한 번과 그 방문이 준 1회 권리를 만들고, 그 권리에 발행 작업을 붙인다.
async function visitWithJob(db: Db, account: string, job: Partial<Parameters<typeof seedMintJob>[1]> = {}) {
  const visit = await claim(db, { account, shop: 'real-shop', at: `${today}T03:00:00Z` });
  const entitlement = (await entitlementsOf(db.pool, account))[0]!;
  assert.equal(entitlement.status, 'GRANTED');
  const jobId = await seedMintJob(db.pool, {
    entitlementId: entitlement.id, account, target: 1, status: 'QUEUED', ...job,
  });
  return { visitId: visit.visit.visitEventId, entitlementId: entitlement.id, jobId };
}

async function addVisit(pool: Pool, input: { account: string; shop: Shop; date: string; counted?: boolean }): Promise<string> {
  const claimSlotId = randomUUID();
  const at = `${input.date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes', $7,
       $7::timestamptz - interval '5 minutes', $7)`,
    [claimSlotId, input.shop, input.account, randomBytes(32), staffOf[input.shop], randomBytes(32), at],
  );
  const visitId = randomUUID();
  await pool.query(
    `INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at,
       business_date, verification_level, status, progress_counted)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', 'VALID', $8)`,
    [visitId, claimSlotId, input.shop, `campaign-${input.shop}`, input.account, at, input.date, input.counted ?? true],
  );
  return visitId;
}

// 서로 다른 점포 3곳을 같은 날 한 번씩: 탐험가 골드(3)만 얻어 배지가 정확히 3개다.
async function threeTiers(pool: Pool, account: string, date = today): Promise<Record<Shop, string>> {
  return {
    'real-shop': await addVisit(pool, { account, shop: 'real-shop', date }),
    'other-shop': await addVisit(pool, { account, shop: 'other-shop', date }),
    'demo-shop': await addVisit(pool, { account, shop: 'demo-shop', date }),
  };
}

async function addOffer(pool: Pool, input: { milestone: 1 | 2 | 3; shop: Shop; cap?: number }): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, issuance_cap,
       issued_count, status, consent_note)
     VALUES ($1, $2, $3, $4, '시험 혜택입니다.', 30, $5, 0, 'ACTIVE', '점주 동의 시험 기록')`,
    [id, input.milestone, input.shop, `혜택 ${input.milestone}`, input.cap ?? null],
  );
  return id;
}

async function identityFor(db: Db, account: string, shop: Shop): Promise<string> {
  const created = await db.identities.create(account);
  await db.identities.resolve({ token: created.token, merchantId: shop, staffAccountId: staffOf[shop] });
  return created.token;
}

async function openedCoupon(db: Db, account: string): Promise<{ couponId: string; offerId: string }> {
  const opened = await db.badges.openReward({ accountId: account, milestone: 1 });
  const offer = (await rows<{ offer_id: string }>(db.pool, 'SELECT offer_id FROM badge_coupons WHERE id = $1', [opened.coupon.couponId]))[0]!;
  return { couponId: opened.coupon.couponId, offerId: offer.offer_id };
}

async function redeemAt(db: Db, account: string, couponId: string, at: string, staff: 'staff-r' | 'staff-r2' = 'staff-r') {
  db.state.now = new Date(at);
  const created = await db.identities.create(account);
  await db.identities.resolve({ token: created.token, merchantId: 'real-shop', staffAccountId: staff });
  return db.badges.redeemCoupon({ token: created.token, merchantId: 'real-shop', staffAccountId: staff, couponId });
}

// 워커의 대여 조회(SKIP LOCKED)를 그대로 옮겨, 대여 거래를 열어 둔 채 돌려준다.
async function beginWorkerLease(pool: Pool, at: Date): Promise<{ client: PoolClient; jobId: string | undefined }> {
  const client = await pool.connect();
  await client.query('BEGIN');
  const row = (await client.query<{ job_id: string; outbox_id: string }>(
    `SELECT job.id AS job_id, outbox.id AS outbox_id
     FROM outbox_events AS outbox JOIN mint_jobs AS job ON job.id = outbox.aggregate_id
     WHERE outbox.event_type = 'MINT_REQUESTED'
       AND ((outbox.status = 'PENDING' AND outbox.available_at <= $1)
         OR (outbox.status = 'LEASED' AND outbox.lease_expires_at <= $1))
       AND job.status NOT IN ('FINALIZED', 'PAUSED', 'MANUAL_REVIEW', 'CANCELLED')
     ORDER BY outbox.available_at, outbox.created_at, outbox.id
     FOR UPDATE OF outbox, job SKIP LOCKED
     LIMIT 1`, [at])).rows[0];
  if (row) {
    await client.query(
      `UPDATE outbox_events SET status = 'LEASED', lease_owner = 'worker-1', lease_expires_at = $2, updated_at = $1 WHERE id = $3`,
      [at, new Date(at.getTime() + 60_000), row.outbox_id]);
  }
  return { client, jobId: row?.job_id };
}

test('only an active member of the same store can list or cancel and cross-store ids look like missing visits', async (t) => {
  const db = await setup(t);
  const visit = await claim(db, { account: 'cust-1', shop: 'real-shop' });
  const visitId = visit.visit.visitEventId;

  await assert.rejects(cancel(db, visitId, { staffAccountId: 'staff-o' }), forbidden);
  await assert.rejects(cancel(db, visitId, { staffAccountId: 'nobody' }), forbidden);
  await db.pool.query(`UPDATE merchant_members SET status = 'REVOKED', revoked_at = now()
    WHERE merchant_id = 'real-shop' AND account_id = 'staff-r2'`);
  await assert.rejects(cancel(db, visitId, { staffAccountId: 'staff-r2' }), forbidden);
  await assert.rejects(db.reversal.listRecentVisits({ merchantId: 'real-shop', staffAccountId: 'staff-r2' }), forbidden);
  await assert.rejects(db.reversal.listRecentVisits({ merchantId: 'real-shop', staffAccountId: 'staff-o' }), forbidden);
  await assert.rejects(db.reversal.listRecentCouponRedemptions({ merchantId: 'real-shop', staffAccountId: 'staff-o' }), forbidden);
  // 다른 점포 직원이 자기 점포 경로로 이 방문을 지목해도 방문이 없는 것과 같다.
  await assert.rejects(cancel(db, visitId, { merchantId: 'other-shop', staffAccountId: 'staff-o' }), reversalCode('VISIT_NOT_FOUND'));
  await assert.rejects(cancel(db, randomUUID()), reversalCode('VISIT_NOT_FOUND'));
  await assert.rejects(cancel(db, 'not-a-uuid'), reversalCode('VISIT_NOT_FOUND'));
  assert.equal((await visitState(db.pool, visitId)).status, 'VALID');
  assert.equal((await entitlementsOf(db.pool, 'cust-1'))[0]!.status, 'GRANTED');
});

test('a visit is cancelled with its reason, actor and time and the customer recount follows', async (t) => {
  const db = await setup(t);
  const visit = await claim(db, { account: 'cust-1', shop: 'real-shop' });
  const visitId = visit.visit.visitEventId;
  assert.equal((await db.badges.getBadges('cust-1')).medals[0]!.value, 1);

  const result = await cancel(db, visitId, { reason: 'DUPLICATE', note: '  같은   주문을\n두 번 확인 ' });
  assert.deepEqual(result, {
    visitEventId: visitId, status: 'CANCELED', reason: 'DUPLICATE', note: '같은 주문을 두 번 확인',
    canceledAt: `${today}T03:00:00.000Z`, revokedRewardCount: 1, voidedCouponCount: 0, replayed: false,
  });
  const stored = await visitState(db.pool, visitId);
  assert.equal(stored.status, 'CANCELED');
  assert.equal(stored.cancellation_reason, 'DUPLICATE');
  assert.equal(stored.cancellation_note, '같은 주문을 두 번 확인');
  assert.equal(stored.canceled_by_account_id, 'staff-r');
  assert.equal(stored.canceled_at?.toISOString(), `${today}T03:00:00.000Z`);
  const [entitlement] = await entitlementsOf(db.pool, 'cust-1');
  assert.equal(entitlement!.status, 'CANCELED');
  assert.equal(entitlement!.revoked_by_visit_event_id, visitId);
  // 취소된 방문은 메달·도감에서 빠진다.
  const badges = await db.badges.getBadges('cust-1');
  assert.deepEqual(badges.medals.map(({ value }) => value), [0, 0, 0]);
  const listed = await db.reversal.listRecentVisits({ merchantId: 'real-shop', staffAccountId: 'staff-r' });
  assert.equal(listed.visits[0]!.status, 'CANCELED');
  assert.equal(listed.visits[0]!.canCancel, false);
  assert.equal(listed.visits[0]!.cancellationReason, 'DUPLICATE');
});

test('invalid reasons and notes are rejected before anything changes', async (t) => {
  const db = await setup(t);
  const visitId = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit.visitEventId;
  for (const reason of [undefined, '', 'wrong_customer', 'ISSUED_IN_ERROR', 5, null]) {
    await assert.rejects(cancel(db, visitId, { reason }), reversalCode('INVALID_REVERSAL_REASON'));
  }
  for (const note of ['x'.repeat(101), 'kim@example.com', '010-1234-5678', 42]) {
    await assert.rejects(cancel(db, visitId, { note }), reversalCode('INVALID_REVERSAL_NOTE'));
  }
  assert.equal((await visitState(db.pool, visitId)).status, 'VALID');
  const ok = await cancel(db, visitId, { reason: 'OTHER', note: '   ' });
  assert.equal(ok.note, null);
});

test('the cancellation window is the visit business day in Korea, exact to the millisecond', async (t) => {
  const db = await setup(t);
  // 방문은 14:00 KST(05:00Z). 같은 날 마지막 순간까지는 취소되고 15:00:00.000Z(다음 날 0시 KST)부터는 안 된다.
  const first = (await claim(db, { account: 'cust-1', shop: 'real-shop', at: `${today}T05:00:00.000Z` })).visit.visitEventId;
  const second = (await claim(db, { account: 'cust-2', shop: 'real-shop', at: `${today}T05:00:00.000Z` })).visit.visitEventId;
  db.state.now = new Date(`${today}T15:00:00.000Z`);
  await assert.rejects(cancel(db, first), reversalCode('VISIT_CANCEL_WINDOW_CLOSED'));
  await assert.rejects(cancel(db, first), reversalCode('VISIT_CANCEL_WINDOW_CLOSED'));
  assert.equal((await visitState(db.pool, first)).status, 'VALID');
  assert.equal((await entitlementsOf(db.pool, 'cust-1'))[0]!.status, 'GRANTED');
  db.state.now = new Date(`${today}T14:59:59.999Z`);
  assert.equal((await cancel(db, second)).status, 'CANCELED');
  // 다음 영업일 목록에는 어제 방문이 보이지 않는다.
  db.state.now = new Date(`${today}T15:00:00.000Z`);
  assert.deepEqual((await db.reversal.listRecentVisits({ merchantId: 'real-shop', staffAccountId: 'staff-r' })).visits, []);
});

test('cancelling twice returns the stored result and concurrent cancels settle on one change', async (t) => {
  const db = await setup(t);
  const visitId = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit.visitEventId;
  const first = await cancel(db, visitId, { reason: 'NOT_A_REAL_VISIT', note: '처음 사유' });
  db.state.now = new Date(`${today}T04:00:00.000Z`);
  const again = await cancel(db, visitId, { reason: 'OTHER', note: '다른 사유' });
  assert.deepEqual(again, { ...first, replayed: true });
  // 다른 점원이 다시 눌러도 같은 결과다. 창이 닫힌 뒤에도 이미 취소된 방문은 같은 결과를 돌려준다.
  db.state.now = new Date(`${today}T16:00:00.000Z`);
  assert.deepEqual(await cancel(db, visitId, { staffAccountId: 'staff-r2' }), { ...first, replayed: true });

  const raceVisit = (await claim(db, { account: 'cust-2', shop: 'real-shop', at: `${today}T03:00:00Z` })).visit.visitEventId;
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
    cancel(db, raceVisit, { staffAccountId: index % 2 ? 'staff-r' : 'staff-r2' })));
  assert.equal(results.every((result) => result.status === 'fulfilled'), true, JSON.stringify(results));
  const values = results.map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<typeof cancel>>>).value);
  assert.equal(values.filter((value) => !value.replayed).length, 1);
  assert.equal(new Set(values.map((value) => value.canceledAt)).size, 1);
  assert.equal((await entitlementsOf(db.pool, 'cust-2')).filter((row) => row.status === 'CANCELED').length, 1);
});

test('unsent mint jobs are cancelled with their entitlement and the goal can be earned and minted again', async (t) => {
  const db = await setup(t);
  // 세 날 방문: 1회 권리(1일차)와 3회 권리(3일차).
  await claim(db, { account: 'cust-1', shop: 'real-shop', at: '2026-09-28T03:00:00Z' });
  await claim(db, { account: 'cust-1', shop: 'real-shop', at: '2026-09-29T03:00:00Z' });
  const third = (await claim(db, { account: 'cust-1', shop: 'real-shop', at: `${today}T03:00:00Z` })).visit.visitEventId;
  const before = await entitlementsOf(db.pool, 'cust-1');
  assert.deepEqual(before.map((row) => [row.target_visit_count, row.status]), [[1, 'GRANTED'], [3, 'GRANTED']]);
  const goalThree = before[1]!;
  assert.equal(goalThree.source_visit_event_id, third);
  const jobId = await seedMintJob(db.pool, {
    entitlementId: goalThree.id, account: 'cust-1', target: 3, status: 'QUEUED', outbox: 'PENDING',
  });

  const result = await cancel(db, third);
  assert.equal(result.revokedRewardCount, 1);
  const [job] = await rows<{ status: string; last_error_code: string }>(db.pool,
    'SELECT status, last_error_code FROM mint_jobs WHERE id = $1', [jobId]);
  assert.deepEqual(job, { status: 'CANCELLED', last_error_code: 'VISIT_CANCELED' });
  const [outbox] = await rows<{ status: string; lease_owner: string | null }>(db.pool,
    'SELECT status, lease_owner FROM outbox_events WHERE aggregate_id = $1', [jobId]);
  assert.deepEqual(outbox, { status: 'PUBLISHED', lease_owner: null });
  const after = await entitlementsOf(db.pool, 'cust-1');
  assert.deepEqual(after.map((row) => [row.target_visit_count, row.status]), [[1, 'GRANTED'], [3, 'CANCELED']]);
  assert.equal(after[1]!.revoked_by_visit_event_id, third);
  // 남은 진행은 2회라 3회 권리는 보이지 않는다.
  assert.deepEqual((await rows(db.pool, `SELECT 1 FROM reward_entitlements WHERE customer_account_id = 'cust-1'
    AND status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED') AND target_visit_count = 3`)), []);

  // 다음 날 정당한 방문으로 다시 채우면 새 권리가 생기고, 취소된 권리와 나란히 남는다.
  const again = await claim(db, { account: 'cust-1', shop: 'real-shop', at: '2026-10-01T03:00:00Z' });
  assert.equal(again.visit.progressVisitCount, 3);
  assert.equal(again.grantedRewards.length, 1);
  assert.equal(again.grantedRewards[0]!.targetVisitCount, 3);
  assert.notEqual(again.grantedRewards[0]!.entitlementId, goalThree.id);
  const reissued = await entitlementsOf(db.pool, 'cust-1');
  assert.deepEqual(reissued.filter((row) => row.target_visit_count === 3).map((row) => row.status).sort(), ['CANCELED', 'GRANTED']);

  // 새 권리는 같은 계정으로 다시 발행 요청할 수 있다. 취소된 작업은 발행 상한(1)에서 빠진다.
  await db.pool.query(`UPDATE nft_series SET max_ever_minted = 1 WHERE id = 'series-3'`);
  const bindingId = (await rows<{ id: string }>(db.pool, `SELECT id FROM wallet_bindings WHERE account_id = 'cust-1'`))[0]!.id;
  const requested = await db.mints.requestMint({
    accountId: 'cust-1', entitlementId: again.grantedRewards[0]!.entitlementId, walletBindingId: bindingId,
    bindingVersion: 1, consentVersion: 'nft-mint-v1', idempotencyKey: 'reissue-after-cancel-1',
  });
  assert.equal(requested.status, 'QUEUED');
  await db.pool.query(`UPDATE nft_series SET max_ever_minted = 1 WHERE id = 'series-3'`);
  await assert.rejects(
    db.mints.requestMint({
      accountId: 'cust-1', entitlementId: goalThree.id, walletBindingId: bindingId,
      bindingVersion: 1, consentVersion: 'nft-mint-v1', idempotencyKey: 'canceled-entitlement-1',
    }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'ENTITLEMENT_NOT_MINTABLE',
  );
});

test('a mint already submitted, finalized or with a lost response refuses the cancellation and changes nothing', async (t) => {
  const db = await setup(t);
  const cases: { name: string; job: Partial<Parameters<typeof seedMintJob>[1]> }[] = [
    { name: 'submitted', job: { status: 'SUBMITTED', transactionHash: txHash, outbox: 'PUBLISHED' } },
    { name: 'confirming', job: { status: 'CONFIRMING', transactionHash: txHash, outbox: 'PENDING' } },
    { name: 'finalized', job: { status: 'FINALIZED', transactionHash: txHash, outbox: 'PUBLISHED', entitlementStatus: 'FULFILLED' } },
    { name: 'retryable with hash', job: { status: 'RETRYABLE', transactionHash: txHash } },
    { name: 'response lost', job: { status: 'RETRYABLE', lastErrorCode: 'MINT_SUBMISSION_RESPONSE_LOST' } },
    { name: 'fulfilled entitlement', job: { status: 'FINALIZED', entitlementStatus: 'FULFILLED' } },
  ];
  for (const [index, item] of cases.entries()) {
    const account = `cust-${index}`;
    const { visitId, entitlementId, jobId } = await visitWithJob(db, account, item.job);
    await assert.rejects(cancel(db, visitId), reversalCode('VISIT_REWARD_ALREADY_MINTED'), item.name);
    assert.equal((await visitState(db.pool, visitId)).status, 'VALID', item.name);
    const [entitlement] = await rows<{ status: string; revoked_by_visit_event_id: string | null }>(db.pool,
      'SELECT status, revoked_by_visit_event_id FROM reward_entitlements WHERE id = $1', [entitlementId]);
    assert.equal(entitlement!.status, item.job.entitlementStatus ?? 'MINT_REQUESTED', item.name);
    assert.equal(entitlement!.revoked_by_visit_event_id, null, item.name);
    const [job] = await rows<{ status: string }>(db.pool, 'SELECT status FROM mint_jobs WHERE id = $1', [jobId]);
    assert.equal(job!.status, item.job.status, item.name);
  }
});

test('a refused cancellation rolls back every other change including coupons and promotion', async (t) => {
  const db = await setup(t);
  // 같은 날 두 번 방문(둘째는 세지 않음)과 이미 발행 중인 1회 권리, 그리고 쿠폰.
  const { visitId } = await visitWithJob(db, 'cust-1', { status: 'SUBMITTED', transactionHash: txHash });
  const duplicate = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit;
  assert.equal(duplicate.progressCounted, false);
  await assert.rejects(cancel(db, visitId), reversalCode('VISIT_REWARD_ALREADY_MINTED'));
  assert.equal((await visitState(db.pool, visitId)).status, 'VALID');
  assert.equal((await visitState(db.pool, duplicate.visitEventId)).progress_counted, false);
});

test('a live outbox lease or a locked job means the worker may be sending and the cancellation waits', async (t) => {
  const db = await setup(t);
  const live = await visitWithJob(db, 'cust-live', { outbox: 'LEASED', leaseExpiresAt: `${today}T03:05:00Z` });
  await assert.rejects(cancel(db, live.visitId), reversalCode('VISIT_REWARD_MINT_IN_PROGRESS'));
  assert.equal((await visitState(db.pool, live.visitId)).status, 'VALID');
  // 대여가 만료됐고 아직 보낸 적이 없으면 취소할 수 있다(계정 삭제와 같은 기준).
  db.state.now = new Date(`${today}T03:05:00.001Z`);
  assert.equal((await cancel(db, live.visitId)).revokedRewardCount, 1);
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM mint_jobs WHERE id = $1', [live.jobId]))[0]!.status, 'CANCELLED');

  // 워커가 대여를 잡고 거래를 열어 둔 동안 취소는 기다리지 않고 거절한다.
  db.state.now = new Date(`${today}T03:00:00.000Z`);
  const held = await visitWithJob(db, 'cust-held');
  const worker = await beginWorkerLease(db.pool, db.state.now);
  assert.equal(worker.jobId, held.jobId);
  await assert.rejects(cancel(db, held.visitId), reversalCode('VISIT_REWARD_MINT_IN_PROGRESS'));
  await worker.client.query('COMMIT');
  worker.client.release();
  // 대여가 커밋된 뒤에도 유효한 대여라 거절한다.
  await assert.rejects(cancel(db, held.visitId), reversalCode('VISIT_REWARD_MINT_IN_PROGRESS'));
  // 워커가 전송까지 마치면 이미 발행된 것으로 거절한다.
  await db.pool.query(`UPDATE mint_jobs SET status = 'SUBMITTED', transaction_hash = $2 WHERE id = $1`, [held.jobId, txHash]);
  await assert.rejects(cancel(db, held.visitId), reversalCode('VISIT_REWARD_ALREADY_MINTED'));
  assert.equal((await visitState(db.pool, held.visitId)).status, 'VALID');
});

test('a cancellation that commits first hides the job from the worker lease', async (t) => {
  const db = await setup(t);
  const { visitId, jobId } = await visitWithJob(db, 'cust-1');
  await cancel(db, visitId);
  const worker = await beginWorkerLease(db.pool, db.state.now);
  assert.equal(worker.jobId, undefined);
  await worker.client.query('COMMIT');
  worker.client.release();
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM mint_jobs WHERE id = $1', [jobId]))[0]!.status, 'CANCELLED');
});

test('cancellation racing a worker lease never cancels a job the worker holds', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 8; round++) {
    const { visitId, jobId } = await visitWithJob(db, `cust-race-${round}`);
    const workerRun = (async () => {
      const worker = await beginWorkerLease(db.pool, db.state.now);
      await worker.client.query('COMMIT');
      worker.client.release();
      return worker.jobId;
    })();
    const [cancelled, leased] = await Promise.allSettled([cancel(db, visitId), workerRun]);
    const [job] = await rows<{ status: string }>(db.pool, 'SELECT status FROM mint_jobs WHERE id = $1', [jobId]);
    const [outbox] = await rows<{ status: string }>(db.pool, 'SELECT status FROM outbox_events WHERE aggregate_id = $1', [jobId]);
    assert.equal(leased.status, 'fulfilled');
    if (cancelled.status === 'fulfilled') {
      assert.equal((leased as PromiseFulfilledResult<string | undefined>).value, undefined, `round ${round}`);
      assert.deepEqual([job!.status, outbox!.status], ['CANCELLED', 'PUBLISHED'], `round ${round}`);
    } else {
      assert.ok(reversalCode('VISIT_REWARD_MINT_IN_PROGRESS')(cancelled.reason), `round ${round}: ${String(cancelled.reason)}`);
      assert.equal((leased as PromiseFulfilledResult<string | undefined>).value, jobId, `round ${round}`);
      assert.deepEqual([job!.status, outbox!.status], ['QUEUED', 'LEASED'], `round ${round}`);
      assert.equal((await visitState(db.pool, visitId)).status, 'VALID');
    }
  }
});

test('a worker finalising a mint holds the job so the cancellation gives up instead of deadlocking', async (t) => {
  const db = await setup(t);
  const { visitId, entitlementId, jobId } = await visitWithJob(db, 'cust-1', {
    status: 'CONFIRMING', transactionHash: txHash, outbox: 'PENDING',
  });
  // 워커는 작업 행을 먼저 잠그고 권리를 나중에 바꾼다(확정). 취소는 권리를 먼저 잠그므로 작업을 기다리면 교착할 수 있다.
  const worker = await db.pool.connect();
  await worker.query('BEGIN');
  await worker.query(`UPDATE mint_jobs SET status = 'FINALIZED', finalized_at = now(), updated_at = now() WHERE id = $1`, [jobId]);
  await assert.rejects(cancel(db, visitId), reversalCode('VISIT_REWARD_MINT_IN_PROGRESS'));
  // 취소가 물러났으니 워커는 기다림 없이 권리를 마저 바꾸고 커밋한다.
  await worker.query(`UPDATE reward_entitlements SET status = 'FULFILLED', updated_at = now() WHERE id = $1`, [entitlementId]);
  await worker.query('COMMIT');
  worker.release();
  await assert.rejects(cancel(db, visitId), reversalCode('VISIT_REWARD_ALREADY_MINTED'));
  assert.equal((await visitState(db.pool, visitId)).status, 'VALID');
  assert.equal((await entitlementsOf(db.pool, 'cust-1'))[0]!.status, 'FULFILLED');
});

test('cancellation racing the customer mint request ends with a cancelled job or a refused request', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 6; round++) {
    const account = `cust-mint-${round}`;
    const visit = await claim(db, { account, shop: 'real-shop', at: `${today}T03:00:00Z` });
    const entitlement = (await entitlementsOf(db.pool, account))[0]!;
    const address = `0x${randomBytes(20).toString('hex')}`;
    const bindingId = randomUUID();
    await db.pool.query(
      `INSERT INTO wallet_bindings (id, account_id, address_checksum, address_normalized, chain_id, binding_version,
         status, verified_at) VALUES ($1, $2, $3, $3, 31337, 1, 'VERIFIED', now())`, [bindingId, account, address]);
    const [cancelled, requested] = await Promise.allSettled([
      cancel(db, visit.visit.visitEventId),
      db.mints.requestMint({ accountId: account, entitlementId: entitlement.id, walletBindingId: bindingId,
        bindingVersion: 1, consentVersion: 'nft-mint-v1', idempotencyKey: `race-mint-${round}` }),
    ]);
    const [state] = await rows<{ visit: string; entitlement: string; job: string | null }>(db.pool,
      `SELECT (SELECT status FROM visit_events WHERE id = $1) AS visit,
              (SELECT status FROM reward_entitlements WHERE id = $2) AS entitlement,
              (SELECT status FROM mint_jobs WHERE entitlement_id = $2) AS job`,
      [visit.visit.visitEventId, entitlement.id]);
    // 어느 쪽이 먼저든 방문·권리·작업 상태가 서로 어긋나면 안 된다.
    assert.equal(cancelled.status, 'fulfilled', `round ${round}: ${String(cancelled.status === 'rejected' && cancelled.reason)}`);
    assert.equal(state!.visit, 'CANCELED');
    assert.equal(state!.entitlement, 'CANCELED');
    if (requested.status === 'fulfilled') assert.equal(state!.job, 'CANCELLED', `round ${round}`);
    else {
      assert.ok(requested.reason instanceof MintRequestError && requested.reason.code === 'ENTITLEMENT_NOT_MINTABLE', `round ${round}`);
      assert.equal(state!.job, null);
    }
  }
});

test('cancelling the visit that reached a goal revokes the goals the recount no longer reaches', async (t) => {
  const db = await setup(t);
  for (const [index, date] of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'].entries()) {
    await claim(db, { account: 'cust-1', shop: 'real-shop', at: `${date}T03:00:00Z` });
    assert.equal((await entitlementsOf(db.pool, 'cust-1')).length, index < 2 ? 1 : 2);
  }
  const fifth = await claim(db, { account: 'cust-1', shop: 'real-shop', at: `${today}T03:00:00Z` });
  assert.deepEqual((await entitlementsOf(db.pool, 'cust-1')).map((row) => row.target_visit_count), [1, 3, 5]);
  const result = await cancel(db, fifth.visit.visitEventId);
  assert.equal(result.revokedRewardCount, 1);
  assert.deepEqual((await entitlementsOf(db.pool, 'cust-1')).map((row) => [row.target_visit_count, row.status]),
    [[1, 'GRANTED'], [3, 'GRANTED'], [5, 'CANCELED']]);
});

test('a same-day duplicate that was hidden behind the cancelled visit is counted instead', async (t) => {
  const db = await setup(t);
  const first = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit;
  const second = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit;
  assert.deepEqual([first.progressCounted, second.progressCounted], [true, false]);
  const result = await cancel(db, first.visitEventId, { reason: 'DUPLICATE' });
  assert.equal(result.revokedRewardCount, 1);
  assert.equal((await visitState(db.pool, second.visitEventId)).progress_counted, true);
  const entitlements = await entitlementsOf(db.pool, 'cust-1');
  assert.deepEqual(entitlements.map((row) => [row.status, row.source_visit_event_id]).sort(),
    [['CANCELED', first.visitEventId], ['GRANTED', second.visitEventId]]);
  // 하루 1건 색인은 그대로라 같은 날 세는 방문은 하나뿐이다.
  assert.equal((await rows(db.pool, `SELECT 1 FROM visit_events WHERE customer_account_id = 'cust-1'
    AND status = 'VALID' AND progress_counted`)).length, 1);
});

test('a visit the staff member claimed for themselves is recorded but never counted on a real store', async (t) => {
  const db = await setup(t);
  const own = await claim(db, { account: 'staff-r', shop: 'real-shop', staff: 'staff-r' });
  assert.equal(own.visit.progressCounted, false);
  assert.equal(own.visit.progressExcludedReason, 'STAFF_SELF');
  assert.deepEqual(own.grantedRewards, []);
  assert.equal(own.visit.progressVisitCount, 0);
  assert.deepEqual(await entitlementsOf(db.pool, 'staff-r'), []);
  // 다시 확정해도(재시도) 같은 이유를 돌려준다.
  const stored = await rows<{ claim_slot_id: string }>(db.pool, 'SELECT claim_slot_id FROM visit_events WHERE id = $1', [own.visit.visitEventId]);
  assert.equal(stored.length, 1);
  const badges = await db.badges.getBadges('staff-r');
  assert.deepEqual(badges.medals.map(({ value }) => value), [0, 0, 0]);
  // 점원 목록에는 기록만 된 방문으로 보인다.
  const listed = await db.reversal.listRecentVisits({ merchantId: 'real-shop', staffAccountId: 'staff-r' });
  assert.equal(listed.visits.length, 1);
  assert.equal(listed.visits[0]!.progressCounted, false);

  // 같은 날 다른 직원이 발급한 정당한 방문은 세어지고 하루 1건 색인이 자기 적립 행에 막히지 않는다.
  const legit = await claim(db, { account: 'staff-r', shop: 'real-shop', staff: 'staff-r2' });
  assert.equal(legit.visit.progressCounted, true);
  assert.equal(legit.grantedRewards.length, 1);
  // 자기 적립 방문을 하루에 여러 번 받아도 색인 충돌 없이 모두 기록만 된다.
  const again = await claim(db, { account: 'staff-r', shop: 'real-shop', staff: 'staff-r' });
  assert.equal(again.visit.progressCounted, false);
  assert.equal(again.visit.progressExcludedReason, 'STAFF_SELF');
  assert.equal(again.visit.progressVisitCount, 1);
  assert.equal((await entitlementsOf(db.pool, 'staff-r')).length, 1);
  // 정당한 방문이 있는 날 자기 적립 방문을 취소해도 승격되지 않는다.
  const legitCancel = await cancel(db, legit.visit.visitEventId, { staffAccountId: 'staff-r2' });
  assert.equal(legitCancel.status, 'CANCELED');
  assert.equal((await visitState(db.pool, own.visit.visitEventId)).progress_counted, false);
  assert.equal((await visitState(db.pool, again.visit.visitEventId)).progress_counted, false);
  assert.deepEqual((await db.badges.getBadges('staff-r')).medals.map(({ value }) => value), [0, 0, 0]);
});

test('a demo store keeps counting the same staff member visit', async (t) => {
  const db = await setup(t);
  const own = await claim(db, { account: 'staff-d', shop: 'demo-shop', staff: 'staff-d' });
  assert.equal(own.visit.progressCounted, true);
  assert.equal('progressExcludedReason' in own.visit, false);
  assert.equal(own.grantedRewards.length, 1);
  assert.deepEqual((await db.badges.getBadges('staff-d')).medals.map(({ value }) => value), [1, 1, 1]);
});

test('cancelling a visit voids unused coupons whose badges are gone and a re-earned box revives the coupon', async (t) => {
  const db = await setup(t);
  const offerId = await addOffer(db.pool, { milestone: 1, shop: 'real-shop', cap: 5 });
  const visits = await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  assert.equal((await rows<{ issued_count: number }>(db.pool, 'SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId]))[0]!.issued_count, 1);

  const result = await cancel(db, visits['demo-shop'], { merchantId: 'demo-shop', staffAccountId: 'staff-d' });
  assert.equal(result.voidedCouponCount, 1);
  const [coupon] = await rows<{ status: string; void_reason: string; voided_by_account_id: string; void_visit_event_id: string }>(
    db.pool, 'SELECT status, void_reason, voided_by_account_id, void_visit_event_id FROM badge_coupons WHERE id = $1', [couponId]);
  assert.deepEqual(coupon, { status: 'VOIDED', void_reason: 'VISIT_CANCELED', voided_by_account_id: 'staff-d',
    void_visit_event_id: visits['demo-shop'] });
  assert.equal((await rows<{ issued_count: number }>(db.pool, 'SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId]))[0]!.issued_count, 0);
  const audit = await rows<{ action: string; actor_account_id: string; visit_event_id: string }>(db.pool,
    'SELECT action, actor_account_id, visit_event_id FROM badge_coupon_audit WHERE coupon_id = $1', [couponId]);
  assert.deepEqual(audit, [{ action: 'VOIDED_ON_RECOUNT', actor_account_id: 'staff-d', visit_event_id: visits['demo-shop'] }]);
  // 고객에게는 상자가 다시 잠기고 쿠폰은 보이지 않으며 점원 조회·사용도 되지 않는다.
  const book = await db.badges.getBadges('cust-c');
  assert.equal(book.rewards[0]!.state, 'LOCKED');
  assert.equal(book.rewards[0]!.coupon, null);
  const token = await identityFor(db, 'cust-c', 'real-shop');
  assert.deepEqual((await db.badges.lookupCoupons({ token, merchantId: 'real-shop', staffAccountId: 'staff-r' })).coupons, []);
  await assert.rejects(
    db.badges.redeemCoupon({ token, merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
    (error: unknown) => error instanceof BadgeRewardError && error.code === 'COUPON_VOIDED',
  );

  // 조건을 다시 채우면 같은 쿠폰 행을 새 혜택 사본으로 되살린다.
  await addVisit(db.pool, { account: 'cust-c', shop: 'demo-shop', date: '2026-09-29' });
  assert.equal((await db.badges.getBadges('cust-c')).rewards[0]!.state, 'READY');
  const revived = await db.badges.openReward({ accountId: 'cust-c', milestone: 1 });
  assert.equal(revived.replayed, false);
  assert.equal(revived.coupon.couponId, couponId);
  assert.equal(revived.coupon.status, 'ISSUED');
  const [after] = await rows<{ status: string; void_reason: string | null; voided_at: Date | null }>(db.pool,
    'SELECT status, void_reason, voided_at FROM badge_coupons WHERE id = $1', [couponId]);
  assert.deepEqual(after, { status: 'ISSUED', void_reason: null, voided_at: null });
  assert.equal((await rows<{ issued_count: number }>(db.pool, 'SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId]))[0]!.issued_count, 1);
  assert.deepEqual((await rows<{ action: string }>(db.pool,
    'SELECT action FROM badge_coupon_audit WHERE coupon_id = $1 ORDER BY created_at, action', [couponId])).map((row) => row.action).sort(),
    ['REISSUED_AFTER_RECOUNT', 'VOIDED_ON_RECOUNT']);
});

test('a redeemed coupon and coupons whose badges still hold are left untouched by a cancellation', async (t) => {
  const db = await setup(t);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  // 어제 real-shop 방문이 하나 더 있어 오늘 방문 하나를 취소해도 배지가 3개 이상 남는다: 탐험가 3 + 꾸준한 걸음 1.
  const keeper = await threeTiers(db.pool, 'cust-keep');
  await addVisit(db.pool, { account: 'cust-keep', shop: 'real-shop', date: '2026-09-29' });
  const kept = await openedCoupon(db, 'cust-keep');
  const keptResult = await cancel(db, keeper['real-shop']);
  assert.equal(keptResult.voidedCouponCount, 0);
  assert.equal((await db.badges.getBadges('cust-keep')).earnedTiers, 4);
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM badge_coupons WHERE id = $1', [kept.couponId]))[0]!.status, 'ISSUED');

  // 사용한 쿠폰은 배지가 사라져도 건드리지 않는다.
  const used = await threeTiers(db.pool, 'cust-used');
  const { couponId } = await openedCoupon(db, 'cust-used');
  await redeemAt(db, 'cust-used', couponId, `${today}T03:00:00Z`);
  const result = await cancel(db, used['demo-shop'], { merchantId: 'demo-shop', staffAccountId: 'staff-d' });
  assert.equal(result.voidedCouponCount, 0);
  assert.equal((await db.badges.getBadges('cust-used')).earnedTiers, 2);
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM badge_coupons WHERE id = $1', [couponId]))[0]!.status, 'REDEEMED');
});

test('a redeemed coupon is undone within ten minutes by any member of the store, once, with an audit row', async (t) => {
  const db = await setup(t);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  await redeemAt(db, 'cust-c', couponId, `${today}T03:00:00.000Z`);

  const listed = await db.reversal.listRecentCouponRedemptions({ merchantId: 'real-shop', staffAccountId: 'staff-r2' });
  assert.deepEqual(listed.coupons.map((item) => [item.couponId, item.redeemedByMe, item.canUndo, item.undoUntil]),
    [[couponId, false, true, `${today}T03:10:00.000Z`]]);
  assert.match(listed.coupons[0]!.customerLabel, /^손님 [A-Z2-9]{4}$/);
  assert.equal(JSON.stringify(listed).includes('cust-c'), false);
  assert.equal(JSON.stringify(listed).includes('staff-'), false);

  // 정확히 10분 0초까지 가능하고 1ms 뒤에는 닫힌다.
  db.state.now = new Date(`${today}T03:10:00.001Z`);
  await assert.rejects(db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
    reversalCode('COUPON_UNDO_WINDOW_CLOSED'));
  assert.equal((await db.reversal.listRecentCouponRedemptions({ merchantId: 'real-shop', staffAccountId: 'staff-r' })).coupons[0]!.canUndo, false);
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM badge_coupons WHERE id = $1', [couponId]))[0]!.status, 'REDEEMED');
  db.state.now = new Date(`${today}T03:10:00.000Z`);
  const undone = await db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r2', couponId });
  assert.deepEqual(undone, { couponId, status: 'ISSUED', replayed: false });
  const [coupon] = await rows<{ status: string; redeemed_at: Date | null; redeemed_by_account_id: string | null }>(db.pool,
    'SELECT status, redeemed_at, redeemed_by_account_id FROM badge_coupons WHERE id = $1', [couponId]);
  assert.deepEqual(coupon, { status: 'ISSUED', redeemed_at: null, redeemed_by_account_id: null });
  const [audit] = await rows<{ action: string; actor_account_id: string; previous_redeemed_by_account_id: string; previous_redeemed_at: Date }>(
    db.pool, 'SELECT action, actor_account_id, previous_redeemed_by_account_id, previous_redeemed_at FROM badge_coupon_audit WHERE coupon_id = $1', [couponId]);
  assert.equal(audit!.action, 'REDEMPTION_UNDONE');
  assert.equal(audit!.actor_account_id, 'staff-r2');
  assert.equal(audit!.previous_redeemed_by_account_id, 'staff-r');
  assert.equal(audit!.previous_redeemed_at.toISOString(), `${today}T03:00:00.000Z`);
  // 두 번째 요청은 같은 결과의 재생이고 감사 행을 늘리지 않는다.
  assert.deepEqual(await db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
    { couponId, status: 'ISSUED', replayed: true });
  assert.equal((await rows(db.pool, 'SELECT 1 FROM badge_coupon_audit WHERE coupon_id = $1', [couponId])).length, 1);
  // 되돌린 쿠폰은 다시 사용할 수 있다.
  const again = await redeemAt(db, 'cust-c', couponId, `${today}T03:20:00Z`);
  assert.equal(again.replayed, false);
  assert.deepEqual((await db.reversal.listRecentCouponRedemptions({ merchantId: 'real-shop', staffAccountId: 'staff-r' })).coupons.map((item) => item.canUndo), [true]);
});

test('undoing a coupon is limited to its store and to redeemed coupons', async (t) => {
  const db = await setup(t);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  const undo = (over: Partial<{ merchantId: string; staffAccountId: string; couponId: string }> = {}) =>
    db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r', couponId, ...over });
  // 사용한 적 없는 쿠폰.
  await assert.rejects(undo(), reversalCode('COUPON_NOT_REDEEMED'));
  await redeemAt(db, 'cust-c', couponId, `${today}T03:00:00Z`);
  await assert.rejects(undo({ staffAccountId: 'staff-o' }), forbidden);
  await assert.rejects(undo({ merchantId: 'other-shop', staffAccountId: 'staff-o' }), reversalCode('COUPON_NOT_FOUND'));
  await assert.rejects(undo({ couponId: randomUUID() }), reversalCode('COUPON_NOT_FOUND'));
  await assert.rejects(undo({ couponId: 'nope' }), reversalCode('COUPON_NOT_FOUND'));
  await db.pool.query(`UPDATE merchant_members SET status = 'REVOKED', revoked_at = now() WHERE account_id = 'staff-r2'`);
  await assert.rejects(undo({ staffAccountId: 'staff-r2' }), forbidden);
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM badge_coupons WHERE id = $1', [couponId]))[0]!.status, 'REDEEMED');
  // 무효 쿠폰은 되돌릴 대상이 아니다.
  await db.pool.query(`UPDATE badge_coupons SET status = 'VOIDED', redeemed_at = NULL, redeemed_by_account_id = NULL,
    void_reason = 'OTHER', voided_at = now() WHERE id = $1`, [couponId]);
  await assert.rejects(undo(), reversalCode('COUPON_NOT_REDEEMED'));
});

test('redeeming and undoing at the same moment leave one consistent coupon state and count every undo once', async (t) => {
  const db = await setup(t);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  await redeemAt(db, 'cust-c', couponId, `${today}T03:00:00Z`);
  const token = await identityFor(db, 'cust-c', 'real-shop');
  // 열 번의 동시 되돌리기는 한 번만 바꾸고 나머지는 재생이다.
  const undos = await Promise.allSettled(Array.from({ length: 10 }, (_, index) =>
    db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: index % 2 ? 'staff-r' : 'staff-r2', couponId })));
  assert.equal(undos.every((result) => result.status === 'fulfilled'), true, JSON.stringify(undos));
  assert.equal(undos.filter((result) => result.status === 'fulfilled' && !result.value.replayed).length, 1);

  for (let round = 0; round < 6; round++) {
    await db.pool.query(`UPDATE badge_coupons SET status = 'REDEEMED', redeemed_at = $2, redeemed_by_account_id = 'staff-r'
      WHERE id = $1 AND status = 'ISSUED'`, [couponId, db.state.now]);
    const before = (await rows(db.pool, `SELECT 1 FROM badge_coupon_audit WHERE coupon_id = $1`, [couponId])).length;
    const [redeemed, undone] = await Promise.allSettled([
      db.badges.redeemCoupon({ token, merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
      db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
    ]);
    assert.equal(redeemed.status, 'fulfilled', `round ${round}: ${String(redeemed.status === 'rejected' && redeemed.reason)}`);
    assert.equal(undone.status, 'fulfilled', `round ${round}`);
    const [coupon] = await rows<{ status: string; redeemed_at: Date | null; redeemed_by_account_id: string | null }>(db.pool,
      'SELECT status, redeemed_at, redeemed_by_account_id FROM badge_coupons WHERE id = $1', [couponId]);
    assert.ok(coupon!.status === 'ISSUED' || coupon!.status === 'REDEEMED', `round ${round}`);
    assert.equal(coupon!.status === 'REDEEMED', coupon!.redeemed_at !== null && coupon!.redeemed_by_account_id !== null);
    const after = (await rows(db.pool, `SELECT 1 FROM badge_coupon_audit WHERE coupon_id = $1`, [couponId])).length;
    assert.equal(after - before, (undone as PromiseFulfilledResult<{ replayed: boolean }>).value.replayed ? 0 : 1, `round ${round}`);
  }
});

test('an admin voids an unused coupon with a reason and an audit row, and a voided coupon stays dead', async (t) => {
  const db = await setup(t);
  await db.pool.query(`INSERT INTO auth_identities (provider, subject, account_id, created_at)
    VALUES ('google', 'admin-subject', 'admin-1', now())`);
  await db.pool.query(`INSERT INTO platform_admins (account_id) VALUES ('admin-1')`);
  const offerId = await addOffer(db.pool, { milestone: 1, shop: 'real-shop', cap: 3 });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');

  const listed = await db.admin.listMerchantCoupons('admin-1', 'real-shop');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.couponId, couponId);
  assert.equal(listed[0]!.status, 'ISSUED');
  assert.equal(JSON.stringify(listed).includes('cust-c'), false);
  await assert.rejects(db.admin.listMerchantCoupons('admin-1', 'demo-shop'), (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_MERCHANT_NOT_FOUND');

  const invalid = (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_INVALID_INPUT';
  await assert.rejects(db.admin.voidCoupon('admin-1', couponId, { reason: 'VISIT_CANCELED' }), invalid);
  await assert.rejects(db.admin.voidCoupon('admin-1', couponId, { reason: '' }), invalid);
  await assert.rejects(db.admin.voidCoupon('admin-1', couponId, { reason: 'OTHER', note: 'a@b.co' }), invalid);
  await assert.rejects(db.admin.voidCoupon('cust-c', couponId, { reason: 'OTHER' }), (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_FORBIDDEN');
  await assert.rejects(db.admin.voidCoupon('admin-1', randomUUID(), { reason: 'OTHER' }), (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_COUPON_NOT_FOUND');
  await assert.rejects(db.admin.voidCoupon('admin-1', 'nope', { reason: 'OTHER' }), (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_COUPON_NOT_FOUND');

  const voided = await db.admin.voidCoupon('admin-1', couponId, { reason: 'ABUSE_SUSPECTED', note: '  중복  발급 의심 ' });
  assert.equal(voided.replayed, false);
  assert.equal(voided.coupon.status, 'VOIDED');
  assert.equal(voided.coupon.voidReason, 'ABUSE_SUSPECTED');
  const [coupon] = await rows<{ status: string; void_reason: string; void_note: string; voided_by_account_id: string }>(db.pool,
    'SELECT status, void_reason, void_note, voided_by_account_id FROM badge_coupons WHERE id = $1', [couponId]);
  assert.deepEqual(coupon, { status: 'VOIDED', void_reason: 'ABUSE_SUSPECTED', void_note: '중복 발급 의심', voided_by_account_id: 'admin-1' });
  assert.equal((await rows<{ issued_count: number }>(db.pool, 'SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId]))[0]!.issued_count, 0);
  const audit = await rows<{ actor_account_id: string; merchant_id: string; action: string; before_state: object; after_state: object }>(db.pool,
    `SELECT actor_account_id, merchant_id, action, before_state, after_state FROM platform_admin_audit WHERE action = 'COUPON_VOIDED'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.actor_account_id, 'admin-1');
  assert.equal(audit[0]!.merchant_id, 'real-shop');
  assert.equal(JSON.stringify(audit[0]).includes('cust-c'), false);
  assert.equal((audit[0]!.after_state as { reason: string }).reason, 'ABUSE_SUSPECTED');
  assert.equal((audit[0]!.before_state as { status: string }).status, 'ISSUED');

  // 두 번째는 저장된 결과이고 감사 행을 늘리지 않는다.
  const again = await db.admin.voidCoupon('admin-1', couponId, { reason: 'OTHER' });
  assert.equal(again.replayed, true);
  assert.equal(again.coupon.voidReason, 'ABUSE_SUSPECTED');
  assert.equal((await rows(db.pool, `SELECT 1 FROM platform_admin_audit WHERE action = 'COUPON_VOIDED'`)).length, 1);
  // 관리자 무효화는 상자를 다시 열어도 되살아나지 않고, 고객에게는 무효 쿠폰으로 보인다.
  const reopened = await db.badges.openReward({ accountId: 'cust-c', milestone: 1 });
  assert.equal(reopened.replayed, true);
  assert.equal(reopened.coupon.status, 'VOIDED');
  const book = await db.badges.getBadges('cust-c');
  assert.equal(book.rewards[0]!.state, 'OPENED');
  assert.equal(book.rewards[0]!.coupon!.status, 'VOIDED');
  const token = await identityFor(db, 'cust-c', 'real-shop');
  assert.deepEqual((await db.badges.lookupCoupons({ token, merchantId: 'real-shop', staffAccountId: 'staff-r' })).coupons, []);
  await assert.rejects(
    db.badges.redeemCoupon({ token, merchantId: 'real-shop', staffAccountId: 'staff-r', couponId }),
    (error: unknown) => error instanceof BadgeRewardError && error.code === 'COUPON_VOIDED',
  );
});

test('an admin cannot void a redeemed coupon or a demo store coupon', async (t) => {
  const db = await setup(t);
  await db.pool.query(`INSERT INTO auth_identities (provider, subject, account_id, created_at)
    VALUES ('google', 'admin-subject', 'admin-1', now())`);
  await db.pool.query(`INSERT INTO platform_admins (account_id) VALUES ('admin-1')`);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  await redeemAt(db, 'cust-c', couponId, `${today}T03:00:00Z`);
  await assert.rejects(db.admin.voidCoupon('admin-1', couponId, { reason: 'OTHER' }),
    (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_COUPON_NOT_VOIDABLE');
  assert.equal((await rows<{ status: string }>(db.pool, 'SELECT status FROM badge_coupons WHERE id = $1', [couponId]))[0]!.status, 'REDEEMED');
  assert.equal((await rows(db.pool, `SELECT 1 FROM platform_admin_audit WHERE action = 'COUPON_VOIDED'`)).length, 0);

  await db.pool.query(`DELETE FROM badge_coupons`);
  await db.pool.query(`DELETE FROM badge_reward_offers`);
  await addOffer(db.pool, { milestone: 1, shop: 'demo-shop' });
  const demoCoupon = (await openedCoupon(db, 'cust-c')).couponId;
  await assert.rejects(db.admin.voidCoupon('admin-1', demoCoupon, { reason: 'OTHER' }),
    (e: unknown) => e instanceof AdminError && e.code === 'ADMIN_COUPON_NOT_FOUND');
});

test('deleting a staff account pseudonymises the reversal actors and leaves the records', async (t) => {
  const db = await setup(t);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  const visits = await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  const visitId = (await claim(db, { account: 'cust-x', shop: 'real-shop', staff: 'staff-r2' })).visit.visitEventId;
  await cancel(db, visitId, { staffAccountId: 'staff-r2' });
  await redeemAt(db, 'cust-c', couponId, `${today}T03:00:00Z`, 'staff-r2');
  await db.reversal.undoCouponRedemption({ merchantId: 'real-shop', staffAccountId: 'staff-r2', couponId });
  await cancel(db, visits['demo-shop'], { merchantId: 'demo-shop', staffAccountId: 'staff-d' });
  await db.admin.voidCoupon('staff-r2', couponId, { reason: 'OTHER' }).catch(() => undefined);

  await db.deletion.requestDeletion({ accountId: 'staff-r2', confirmation: 'DELETE MY ACCOUNT' });
  const [left] = await rows<{ n: number }>(db.pool, `SELECT (
      (SELECT count(*) FROM visit_events WHERE canceled_by_account_id = 'staff-r2') +
      (SELECT count(*) FROM badge_coupons WHERE voided_by_account_id = 'staff-r2' OR redeemed_by_account_id = 'staff-r2') +
      (SELECT count(*) FROM badge_coupon_audit WHERE actor_account_id = 'staff-r2' OR previous_redeemed_by_account_id = 'staff-r2')
    )::integer AS n`);
  assert.equal(left!.n, 0);
  assert.equal((await visitState(db.pool, visitId)).status, 'CANCELED');
  assert.match((await visitState(db.pool, visitId)).canceled_by_account_id!, /^deleted:[0-9a-f]{64}$/);
  const [audit] = await rows<{ actor_account_id: string; previous_redeemed_by_account_id: string }>(db.pool,
    `SELECT actor_account_id, previous_redeemed_by_account_id FROM badge_coupon_audit WHERE action = 'REDEMPTION_UNDONE'`);
  assert.match(audit!.actor_account_id, /^deleted:[0-9a-f]{64}$/);
  assert.match(audit!.previous_redeemed_by_account_id, /^deleted:[0-9a-f]{64}$/);
});

test('migration 0030 keeps one active entitlement per goal and rejects inconsistent visit and coupon rows', async (t) => {
  const db = await setup(t);
  const visitId = (await claim(db, { account: 'cust-1', shop: 'real-shop' })).visit.visitEventId;
  const duplicate = (sourceStatus: string) => db.pool.query(
    `INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at)
     VALUES ($1, 'cust-1', 'campaign-real-shop', 1, $2, $3, 'fixed-1', now(), now() + interval '1 day')`,
    [randomUUID(), visitId, sourceStatus]);
  // 취소되지 않은 권리가 이미 있으면 같은 목표를 또 만들 수 없지만 취소된 권리는 여러 개 남을 수 있다.
  // 제약이 부분 유일 색인에서 같은 이름의 부분 제외 제약이 되어 위반 코드가 23505(unique)에서 23P01(exclusion)로 바뀌었다.
  await assert.rejects(duplicate('GRANTED'), (error: unknown) => (error as { code?: string }).code === '23P01');
  await duplicate('CANCELED');
  await duplicate('CANCELED');
  await db.pool.query(`UPDATE reward_entitlements SET status = 'CANCELED' WHERE status = 'GRANTED'`);
  await duplicate('GRANTED');

  const violates = (error: unknown) => (error as { code?: string }).code === '23514';
  await assert.rejects(db.pool.query(`UPDATE visit_events SET canceled_at = now() WHERE id = $1`, [visitId]), violates);
  await assert.rejects(db.pool.query(`UPDATE visit_events SET cancellation_note = $2 WHERE id = $1`, [visitId, 'x'.repeat(101)]), violates);
  await addOffer(db.pool, { milestone: 1, shop: 'real-shop' });
  await threeTiers(db.pool, 'cust-c');
  const { couponId } = await openedCoupon(db, 'cust-c');
  await assert.rejects(db.pool.query(`UPDATE badge_coupons SET status = 'VOIDED' WHERE id = $1`, [couponId]), violates);
  await assert.rejects(db.pool.query(`UPDATE badge_coupons SET voided_at = now(), void_reason = 'OTHER' WHERE id = $1`, [couponId]), violates);
  await assert.rejects(db.pool.query(`UPDATE badge_coupons SET status = 'VOIDED', voided_at = now(), void_reason = 'BOGUS' WHERE id = $1`, [couponId]), violates);
  await db.pool.query(`UPDATE badge_coupons SET status = 'VOIDED', voided_at = now(), void_reason = 'OTHER' WHERE id = $1`, [couponId]);
  await assert.rejects(db.pool.query(`UPDATE badge_coupons SET redeemed_at = now() WHERE id = $1`, [couponId]), violates);
});

// 배포된 API(f1bba2d)의 방문 수령 문장 두 개를 그대로 옮겼다(apps/api/src/postgres/claim-slot-service.ts의 redeem).
// 배포 도중이나 롤백 뒤에도 이 문장이 새 스키마에서 그대로 동작해야 한다.
const deployedVisitInsert = `INSERT INTO visit_events (
             id,
             claim_slot_id,
             merchant_id,
             campaign_id,
             customer_account_id,
             occurred_at,
             business_date,
             verification_level,
             status,
             progress_counted,
             created_at,
             updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             ($6::timestamptz AT TIME ZONE 'Asia/Seoul')::date,
             'MERCHANT_CONFIRMED', 'VALID', true, $6, $6
           )
           ON CONFLICT (customer_account_id, merchant_id, business_date)
             WHERE status = 'VALID' AND progress_counted
           DO NOTHING
           RETURNING id, business_date::text, progress_counted`;
const deployedEntitlementInsert = `INSERT INTO reward_entitlements (
               id,
               customer_account_id,
               campaign_id,
               target_visit_count,
               source_visit_event_id,
               status,
               policy_version,
               earned_at,
               claim_expires_at,
               created_at,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $5, 'GRANTED', 'VISIT_1_3_5_KST_DAILY_V1', $6, $7, $6, $6)
             ON CONFLICT ON CONSTRAINT reward_entitlements_unique_goal DO NOTHING
             RETURNING id, target_visit_count, claim_expires_at`;

test('the deployed API insert statements keep working on the migrated schema', async (t) => {
  const db = await setup(t);
  const at = new Date(`${today}T03:00:00Z`);
  const oldEntitlement = async (visitId: string, target: number) => (await db.pool.query(deployedEntitlementInsert, [
    randomUUID(), 'cust-old', 'campaign-real-shop', target, visitId, at, new Date(at.getTime() + 86_400_000),
  ])).rowCount;
  const oldVisit = async () => {
    const slotId = randomUUID();
    await db.pool.query(
      `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
         token_hash, status, expires_at, claimed_at, created_at, updated_at)
       VALUES ($1, 'real-shop', 'cust-old', $2, 'staff-r', $3, 'CLAIMED', $4::timestamptz + interval '15 minutes', $4,
         $4::timestamptz - interval '5 minutes', $4)`,
      [slotId, randomBytes(32), randomBytes(32), at]);
    return (await db.pool.query<{ id: string }>(deployedVisitInsert, [
      randomUUID(), slotId, 'real-shop', 'campaign-real-shop', 'cust-old', at])).rows[0]?.id;
  };

  // 하루 1건 색인: 첫 방문은 들어가고 같은 날 두 번째는 아무 일도 없이 지나간다.
  const first = await oldVisit();
  assert.ok(first);
  assert.equal(await oldVisit(), undefined);
  // 이미 살아 있는 권리가 있으면 같은 목표의 두 번째 삽입은 아무 일도 하지 않는다.
  assert.equal(await oldEntitlement(first, 1), 1);
  assert.equal(await oldEntitlement(first, 1), 0);
  assert.equal((await entitlementsOf(db.pool, 'cust-old')).length, 1);

  // 새 코드가 방문을 취소하면 권리가 취소되고, 옛 문장이 같은 목표를 다시 채우면 새 권리가 생긴다.
  await cancel(db, first);
  assert.deepEqual((await entitlementsOf(db.pool, 'cust-old')).map((row) => row.status), ['CANCELED']);
  const second = await oldVisit();
  assert.ok(second);
  assert.equal(await oldEntitlement(second, 1), 1);
  assert.equal(await oldEntitlement(second, 1), 0);
  assert.deepEqual((await entitlementsOf(db.pool, 'cust-old')).map((row) => row.status).sort(), ['CANCELED', 'GRANTED']);

  // 열 목록 없는 ON CONFLICT DO NOTHING도 같은 제약으로 막힌다.
  const targetless = await db.pool.query(
    `INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at)
     VALUES ($1, 'cust-old', 'campaign-real-shop', 1, $2, 'GRANTED', 'fixed-1', $3, $4)
     ON CONFLICT DO NOTHING`,
    [randomUUID(), second, at, new Date(at.getTime() + 86_400_000)]);
  assert.equal(targetless.rowCount, 0);
});
