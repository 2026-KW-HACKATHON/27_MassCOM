import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { BadgeRewardError } from './badge-rewards.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAdminService } from './postgres/admin.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService, hashCustomerIdentityToken } from './postgres/customer-identity.js';
import { runMigrations } from './postgres/migrate.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
const day = 24 * 60 * 60 * 1000;
// real-shop만 실제 점포(is_demo = false)이고 나머지는 시연 점포다.
const staffOf = { 'shop-a': 'staff-a', 'shop-b': 'staff-b', 'shop-c': 'staff-c', 'real-shop': 'staff-r' } as const;
type Shop = keyof typeof staffOf;

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE account_deletion_requests, customer_identity_tokens, merchants CASCADE');
  for (const [shop, staff] of Object.entries(staffOf)) {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', $3)`,
      [shop, `가상 ${shop}`, shop !== 'real-shop'],
    );
    await pool.query(
      `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
       VALUES ($1, $2, 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 20)`,
      [`campaign-${shop}`, shop],
    );
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
      [shop, staff],
    );
  }
  const state = { now: new Date('2026-09-29T00:00:00.000Z') };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  return {
    pool, state, lifecycle,
    badges: new PostgresBadgeRewardService(pool, { now, accountLifecycle: lifecycle }),
    identities: new PostgresCustomerIdentityService(pool, { now, accountLifecycle: lifecycle }),
    claims: new PostgresClaimSlotService(pool, {
      now, referenceHmacSecret: 'test-reference-hmac-secret-32-bytes', accountLifecycle: lifecycle,
    }),
    deletion: new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', now, accountLifecycle: lifecycle,
    }),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

async function addVisit(pool: Pool, input: {
  account: string; shop: Shop; date: string; status?: 'VALID' | 'CANCELED'; counted?: boolean;
  issuedBy?: string;
}): Promise<void> {
  const claimSlotId = randomUUID();
  const at = `${input.date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes',
               $7, $7::timestamptz - interval '5 minutes', $7)`,
    [claimSlotId, input.shop, input.account, randomBytes(32), input.issuedBy ?? staffOf[input.shop],
      randomBytes(32), at],
  );
  const canceled = input.status === 'CANCELED';
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at, business_date,
       verification_level, status, progress_counted, cancellation_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', $8, $9, $10)`,
    [randomUUID(), claimSlotId, input.shop, `campaign-${input.shop}`, input.account, at, input.date,
      canceled ? 'CANCELED' : 'VALID', input.counted ?? true, canceled ? '취소 시험' : null],
  );
}

// 서로 다른 점포 3곳을 같은 날 한 번씩: 탐험가 골드(3)만 얻어 배지가 정확히 3개다.
async function threeTiers(pool: Pool, account: string): Promise<void> {
  for (const shop of ['shop-a', 'shop-b', 'shop-c'] as const) {
    await addVisit(pool, { account, shop, date: '2026-09-01' });
  }
}

// 탐험가 3 · 단골 5 · 꾸준한 걸음 7: 배지 9개.
async function nineTiers(pool: Pool, account: string): Promise<void> {
  for (let index = 1; index <= 5; index++) {
    await addVisit(pool, { account, shop: 'shop-a', date: `2026-09-0${index}` });
  }
  await addVisit(pool, { account, shop: 'shop-b', date: '2026-09-06' });
  await addVisit(pool, { account, shop: 'shop-c', date: '2026-09-07' });
}

async function addOffer(pool: Pool, input: {
  milestone: 1 | 2 | 3; shop: Shop; cap?: number; validDays?: number; status?: 'ACTIVE' | 'PAUSED';
}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO badge_reward_offers
       (id, milestone, merchant_id, title, detail, valid_days, issuance_cap, status, consent_note)
     VALUES ($1, $2, $3, $4, '시연 혜택입니다.', $5, $6, $7, '점주 동의 시험 기록')`,
    [id, input.milestone, input.shop, `혜택 ${input.milestone}`, input.validDays ?? 30,
      input.cap ?? null, input.status ?? 'ACTIVE'],
  );
  return id;
}

async function identityFor(db: Db, account: string, shop: Shop): Promise<string> {
  const created = await db.identities.create(account);
  await db.identities.resolve({ token: created.token, merchantId: shop, staffAccountId: staffOf[shop] });
  return created.token;
}

const rejectsWith = (code: string) => ({ code });

async function addMember(pool: Pool, shop: Shop, account: string, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
     VALUES ($1, $2, 'STAFF', $3, CASE WHEN $3 = 'REVOKED' THEN now() END)
     ON CONFLICT (merchant_id, account_id) DO UPDATE
       SET status = EXCLUDED.status, revoked_at = EXCLUDED.revoked_at`,
    [shop, account, status],
  );
}

test('medal values count only VALID counted visits with distinct store and day math', async (t) => {
  const { pool, badges } = await setup(t);
  const empty = await badges.getBadges('nobody');
  assert.deepEqual(empty.medals.map(({ value, tier }) => [value, tier]), [[0, 0], [0, 0], [0, 0]]);
  assert.equal(empty.earnedTiers, 0);
  assert.deepEqual(empty.rewards.map(({ milestone, requiredTiers, state, offer, coupon }) =>
    [milestone, requiredTiers, state, offer, coupon]), [
    [1, 3, 'LOCKED', null, null], [2, 6, 'LOCKED', null, null], [3, 9, 'LOCKED', null, null],
  ]);

  for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
    await addVisit(pool, { account: 'c1', shop: 'shop-a', date });
  }
  await addVisit(pool, { account: 'c1', shop: 'shop-b', date: '2026-09-02' });
  // 취소된 방문, 진행에 세지 않는 같은 날 반복 방문, 다른 고객의 방문은 값에 들어가지 않는다.
  await addVisit(pool, { account: 'c1', shop: 'shop-c', date: '2026-09-04', status: 'CANCELED', counted: false });
  await addVisit(pool, { account: 'c1', shop: 'shop-c', date: '2026-09-05', counted: false });
  await addVisit(pool, { account: 'c1', shop: 'shop-a', date: '2026-09-01', counted: false });
  await addVisit(pool, { account: 'c2', shop: 'shop-c', date: '2026-09-06' });

  const snapshot = await badges.getBadges('c1');
  assert.deepEqual(snapshot.medals, [
    { kind: 'explorer', value: 2, tier: 2, thresholds: [1, 2, 3] },
    { kind: 'regular', value: 3, tier: 2, thresholds: [2, 3, 5] },
    { kind: 'steady', value: 3, tier: 1, thresholds: [2, 4, 7] },
  ]);
  assert.equal(snapshot.earnedTiers, 5);

  await nineTiers(pool, 'gold');
  const gold = await badges.getBadges('gold');
  assert.deepEqual(gold.medals.map(({ value, tier }) => [value, tier]), [[3, 3], [5, 3], [7, 3]]);
  assert.equal(gold.earnedTiers, 9);
});

test('reward states are LOCKED, READY, UNAVAILABLE and OPENED and reveal offers before they unlock', async (t) => {
  const { pool, badges } = await setup(t);
  await addOffer(pool, { milestone: 1, shop: 'shop-a' });
  await addOffer(pool, { milestone: 2, shop: 'shop-b', cap: 1 });
  await addOffer(pool, { milestone: 3, shop: 'shop-c', status: 'PAUSED' });
  await addVisit(pool, { account: 'starter', shop: 'shop-a', date: '2026-09-01' });
  await addVisit(pool, { account: 'starter', shop: 'shop-b', date: '2026-09-01' });
  await threeTiers(pool, 'ready');
  await nineTiers(pool, 'gold-1');
  await nineTiers(pool, 'gold-2');

  const starter = await badges.getBadges('starter');
  assert.deepEqual(starter.rewards.map((reward) => reward.state), ['LOCKED', 'LOCKED', 'LOCKED']);
  assert.deepEqual(starter.rewards[0]!.offer, {
    merchantId: 'shop-a', merchantName: '가상 shop-a', title: '혜택 1', detail: '시연 혜택입니다.', validDays: 30,
  });
  assert.equal(starter.rewards[2]!.offer, null, 'PAUSED offers are not shown');

  const ready = await badges.getBadges('ready');
  assert.deepEqual(ready.rewards.map((reward) => reward.state), ['READY', 'LOCKED', 'LOCKED']);

  // 마일스톤 3은 ACTIVE 혜택이 없어 달성해도 UNAVAILABLE이다.
  const gold = await badges.getBadges('gold-1');
  assert.deepEqual(gold.rewards.map((reward) => reward.state), ['READY', 'READY', 'UNAVAILABLE']);
  await assert.rejects(badges.openReward({ accountId: 'gold-1', milestone: 3 }), rejectsWith('REWARD_OFFER_UNAVAILABLE'));

  const opened = await badges.openReward({ accountId: 'gold-1', milestone: 2 });
  assert.equal(opened.replayed, false);
  const openedReward = (await badges.getBadges('gold-1')).rewards[1]!;
  assert.equal(openedReward.state, 'OPENED');
  assert.equal(openedReward.coupon?.couponId, opened.coupon.couponId);
  assert.equal(openedReward.offer, null, 'an opened box is rendered from its coupon copy');

  // 상한 1장을 다른 고객이 이미 써서 gold-2는 달성했어도 UNAVAILABLE이다.
  assert.deepEqual((await badges.getBadges('gold-2')).rewards.map((reward) => reward.state),
    ['READY', 'UNAVAILABLE', 'UNAVAILABLE']);
  await assert.rejects(badges.openReward({ accountId: 'gold-2', milestone: 2 }), rejectsWith('REWARD_CAPACITY_EXHAUSTED'));
  const count = await pool.query('SELECT issued_count FROM badge_reward_offers WHERE milestone = 2');
  assert.equal(count.rows[0]!.issued_count, 1);
});

test('opening a box is idempotent, snapshots the offer and never over-issues under concurrency', async (t) => {
  const { pool, badges, state } = await setup(t);
  const offerId = await addOffer(pool, { milestone: 1, shop: 'shop-a', validDays: 30 });
  await threeTiers(pool, 'opener');
  await addVisit(pool, { account: 'locked', shop: 'shop-a', date: '2026-09-01' });
  await assert.rejects(badges.openReward({ accountId: 'locked', milestone: 1 }), rejectsWith('REWARD_LOCKED'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM badge_coupons')).rows[0]!.n, 0);

  const first = await badges.openReward({ accountId: 'opener', milestone: 1 });
  assert.equal(first.replayed, false);
  assert.equal(first.coupon.status, 'ISSUED');
  assert.equal(first.coupon.milestone, 1);
  assert.equal(first.coupon.merchantName, '가상 shop-a');
  assert.equal(first.coupon.issuedAt, '2026-09-29T00:00:00.000Z');
  assert.equal(first.coupon.expiresAt, '2026-10-29T14:59:59.999Z');
  assert.equal(first.coupon.redeemedAt, null);

  await pool.query(`UPDATE badge_reward_offers SET title = '바뀐 제목' WHERE id = $1`, [offerId]);
  state.now = new Date('2026-09-30T00:00:00.000Z');
  const replay = await badges.openReward({ accountId: 'opener', milestone: 1 });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.coupon, first.coupon);
  assert.equal(replay.coupon.title, '혜택 1', 'coupon keeps the issue-time copy');
  assert.equal((await pool.query('SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId])).rows[0]!.issued_count, 1);

  for (let index = 0; index < 4; index++) await threeTiers(pool, `racer-${index}`);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) => badges.openReward({ accountId: `racer-${index % 4}`, milestone: 1 })),
  );
  assert.equal(results.filter((result) => !result.replayed).length, 4);
  assert.equal(new Set(results.map((result) => result.coupon.couponId)).size, 4);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM badge_coupons')).rows[0]!.n, 5);
  assert.equal((await pool.query('SELECT issued_count FROM badge_reward_offers WHERE id = $1', [offerId])).rows[0]!.issued_count, 5);

  // 같은 계정의 동시 열기는 한 장만 만든다.
  await threeTiers(pool, 'single');
  const same = await Promise.all(Array.from({ length: 8 }, () => badges.openReward({ accountId: 'single', milestone: 1 })));
  assert.equal(same.filter((result) => !result.replayed).length, 1);
  assert.equal(new Set(same.map((result) => result.coupon.couponId)).size, 1);

  // 상한 2장에 서로 다른 고객 5명이 동시에 열면 정확히 2장만 발급된다.
  await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE id = $1`, [offerId]);
  await addOffer(pool, { milestone: 2, shop: 'shop-b', cap: 2 });
  for (let index = 0; index < 5; index++) await nineTiers(pool, `cap-${index}`);
  const capped = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) => badges.openReward({ accountId: `cap-${index}`, milestone: 2 })),
  );
  assert.equal(capped.filter((result) => result.status === 'fulfilled').length, 2);
  const rejected = capped.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((result) => result.reason instanceof BadgeRewardError
    && result.reason.code === 'REWARD_CAPACITY_EXHAUSTED'));
  assert.equal((await pool.query(`SELECT issued_count FROM badge_reward_offers WHERE milestone = 2`)).rows[0]!.issued_count, 2);
});

test('staff lookup returns only this merchant\'s usable coupons and never the customer account id', async (t) => {
  const db = await setup(t);
  const { pool, badges, identities, state } = db;
  await addOffer(pool, { milestone: 1, shop: 'shop-a' });
  await addOffer(pool, { milestone: 2, shop: 'shop-b' });
  await addOffer(pool, { milestone: 3, shop: 'shop-a' }).then(async (id) => {
    await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE id = $1`, [id]);
  });
  await nineTiers(pool, 'customer-1');
  const first = await badges.openReward({ accountId: 'customer-1', milestone: 1 });
  const second = await badges.openReward({ accountId: 'customer-1', milestone: 2 });

  const tokenA = await identities.create('customer-1');
  await assert.rejects(
    badges.lookupCoupons({ token: tokenA.token, merchantId: 'shop-a', staffAccountId: 'outsider' }),
    rejectsWith('MERCHANT_ACCESS_DENIED'),
  );
  const lookedUp = await badges.lookupCoupons({ token: tokenA.token, merchantId: 'shop-a', staffAccountId: 'staff-a' });
  assert.deepEqual(lookedUp, {
    identityExpiresAt: tokenA.expiresAt,
    coupons: [{ couponId: first.coupon.couponId, title: '혜택 1', detail: '시연 혜택입니다.',
      expiresAt: first.coupon.expiresAt }],
  });
  assert.equal(JSON.stringify(lookedUp).includes('customer-1'), false);
  // 식별 토큰은 이 점포·점원에 묶이므로 다른 점원이 같은 QR을 쓸 수 없다.
  await assert.rejects(
    badges.lookupCoupons({ token: tokenA.token, merchantId: 'shop-b', staffAccountId: 'staff-b' }),
    rejectsWith('CUSTOMER_IDENTITY_UNAVAILABLE'),
  );
  assert.equal((await badges.lookupCoupons({ token: tokenA.token, merchantId: 'shop-a', staffAccountId: 'staff-a' })).coupons.length, 1);

  const tokenB = await identityFor(db, 'customer-1', 'shop-b');
  const atB = await badges.lookupCoupons({ token: tokenB, merchantId: 'shop-b', staffAccountId: 'staff-b' });
  assert.deepEqual(atB.coupons.map((coupon) => coupon.couponId), [second.coupon.couponId]);

  const tokenC = await identityFor(db, 'customer-1', 'shop-c');
  assert.deepEqual((await badges.lookupCoupons({ token: tokenC, merchantId: 'shop-c', staffAccountId: 'staff-c' })).coupons, []);

  // 사용한 쿠폰과 만료된 쿠폰은 조회에서 빠진다.
  const tokenRedeem = await identityFor(db, 'customer-1', 'shop-a');
  await badges.redeemCoupon({ token: tokenRedeem, merchantId: 'shop-a', staffAccountId: 'staff-a', couponId: first.coupon.couponId });
  assert.deepEqual((await badges.lookupCoupons({ token: tokenRedeem, merchantId: 'shop-a', staffAccountId: 'staff-a' })).coupons, []);
  state.now = new Date('2026-11-05T00:00:00.000Z');
  const tokenLate = await identityFor(db, 'customer-1', 'shop-b');
  assert.deepEqual((await badges.lookupCoupons({ token: tokenLate, merchantId: 'shop-b', staffAccountId: 'staff-b' })).coupons, []);

  await assert.rejects(
    badges.lookupCoupons({ token: 'not-a-token', merchantId: 'shop-a', staffAccountId: 'staff-a' }),
    rejectsWith('CUSTOMER_IDENTITY_UNAVAILABLE'),
  );
});

test('redeem is once-only with replay and rejects other stores, customers, unknown ids and expiry without consuming the QR', async (t) => {
  const db = await setup(t);
  const { pool, badges, claims, state } = db;
  await addOffer(pool, { milestone: 1, shop: 'shop-a' });
  await addOffer(pool, { milestone: 2, shop: 'shop-b' });
  await nineTiers(pool, 'customer-1');
  await nineTiers(pool, 'customer-2');
  const atA = await badges.openReward({ accountId: 'customer-1', milestone: 1 });
  const atB = await badges.openReward({ accountId: 'customer-1', milestone: 2 });
  const foreign = await badges.openReward({ accountId: 'customer-2', milestone: 1 });

  const token = await identityFor(db, 'customer-1', 'shop-a');
  const redeemInput = { token, merchantId: 'shop-a', staffAccountId: 'staff-a' };
  const redeemed = await badges.redeemCoupon({ ...redeemInput, couponId: atA.coupon.couponId });
  assert.deepEqual(redeemed, { couponId: atA.coupon.couponId, status: 'REDEEMED',
    redeemedAt: '2026-09-29T00:00:00.000Z', replayed: false });
  state.now = new Date('2026-09-29T00:00:30.000Z');
  const replayed = await badges.redeemCoupon({ ...redeemInput, couponId: atA.coupon.couponId });
  assert.deepEqual(replayed, { ...redeemed, replayed: true });
  const stored = await pool.query('SELECT status, redeemed_at, redeemed_by_account_id FROM badge_coupons WHERE id = $1', [atA.coupon.couponId]);
  assert.equal(stored.rows[0]!.status, 'REDEEMED');
  assert.equal(stored.rows[0]!.redeemed_by_account_id, 'staff-a');
  assert.equal((await badges.getBadges('customer-1')).rewards[0]!.coupon?.status, 'REDEEMED');

  // 다른 점포 쿠폰·다른 고객 쿠폰·없는 쿠폰은 모두 같은 COUPON_NOT_FOUND다.
  for (const couponId of [atB.coupon.couponId, foreign.coupon.couponId, randomUUID(), 'not-a-uuid']) {
    await assert.rejects(badges.redeemCoupon({ ...redeemInput, couponId }), rejectsWith('COUPON_NOT_FOUND'), couponId);
  }
  const untouched = await pool.query(`SELECT count(*)::int AS n FROM badge_coupons WHERE status = 'REDEEMED'`);
  assert.equal(untouched.rows[0]!.n, 1);

  // 사용은 식별 토큰을 소모하지 않아 같은 QR로 방문 코드를 계속 발급할 수 있다.
  const beforeClaim = await pool.query('SELECT consumed_at FROM customer_identity_tokens');
  assert.ok(beforeClaim.rows.every((row) => row.consumed_at === null));
  const issued = await claims.issue({ merchantId: 'shop-a', customerIdentityToken: token,
    merchantReference: 'order-after-coupon', createdByAccountId: 'staff-a' });
  assert.equal('replayed' in issued, false);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM claim_slots WHERE customer_account_id = 'customer-1' AND status = 'ISSUED'`)).rows[0]!.n, 1);
  // 방문 코드가 QR을 소모한 뒤에는 같은 QR로 쿠폰을 더 처리할 수 없다.
  await assert.rejects(badges.redeemCoupon({ ...redeemInput, couponId: atA.coupon.couponId }), rejectsWith('CUSTOMER_IDENTITY_UNAVAILABLE'));

  // 다른 고객의 QR로는 첫 고객의 쿠폰을 사용할 수 없다.
  const otherToken = await identityFor(db, 'customer-2', 'shop-a');
  await assert.rejects(
    badges.redeemCoupon({ token: otherToken, merchantId: 'shop-a', staffAccountId: 'staff-a', couponId: atA.coupon.couponId }),
    rejectsWith('COUPON_NOT_FOUND'),
  );

  // 같은 쿠폰의 동시 사용은 한 번만 처리하고 나머지는 replay로 답한다.
  const raceInput = { token: otherToken, merchantId: 'shop-a', staffAccountId: 'staff-a', couponId: foreign.coupon.couponId };
  const race = await Promise.all(Array.from({ length: 6 }, () => badges.redeemCoupon(raceInput)));
  assert.equal(race.filter((result) => !result.replayed).length, 1);
  assert.equal(new Set(race.map((result) => result.redeemedAt)).size, 1);

  // 만료된 쿠폰은 COUPON_EXPIRED이고 저장 상태는 ISSUED로 남는다.
  state.now = new Date('2026-11-05T00:00:00.000Z');
  const lateToken = await identityFor(db, 'customer-1', 'shop-b');
  await assert.rejects(
    badges.redeemCoupon({ token: lateToken, merchantId: 'shop-b', staffAccountId: 'staff-b', couponId: atB.coupon.couponId }),
    rejectsWith('COUPON_EXPIRED'),
  );
  assert.equal((await pool.query('SELECT status FROM badge_coupons WHERE id = $1', [atB.coupon.couponId])).rows[0]!.status, 'ISSUED');
  assert.equal((await badges.getBadges('customer-1')).rewards[1]!.coupon?.status, 'EXPIRED');

});

test('account deletion pseudonymizes both coupon account columns and blocks new opens', async (t) => {
  const db = await setup(t);
  const { pool, badges, deletion } = db;
  await addOffer(pool, { milestone: 1, shop: 'shop-a' });
  await threeTiers(pool, 'leaving-customer');
  await threeTiers(pool, 'staying-customer');
  const leaving = await badges.openReward({ accountId: 'leaving-customer', milestone: 1 });
  const staying = await badges.openReward({ accountId: 'staying-customer', milestone: 1 });
  const token = await identityFor(db, 'leaving-customer', 'shop-a');
  await badges.redeemCoupon({ token, merchantId: 'shop-a', staffAccountId: 'staff-a', couponId: leaving.coupon.couponId });

  await deletion.requestDeletion({ accountId: 'leaving-customer', confirmation: 'DELETE MY ACCOUNT' });
  let rows = await pool.query('SELECT id, customer_account_id, redeemed_by_account_id FROM badge_coupons ORDER BY id');
  const deletedCustomer = rows.rows.find((row) => row.id === leaving.coupon.couponId)!;
  assert.match(deletedCustomer.customer_account_id, /^deleted:[0-9a-f]{64}$/);
  assert.equal(deletedCustomer.redeemed_by_account_id, 'staff-a');
  assert.equal(rows.rows.find((row) => row.id === staying.coupon.couponId)!.customer_account_id, 'staying-customer');
  assert.equal(rows.rowCount, 2, 'coupons are kept, not deleted');
  assert.equal((await pool.query('SELECT issued_count FROM badge_reward_offers')).rows[0]!.issued_count, 2);
  await assert.rejects(badges.openReward({ accountId: 'leaving-customer', milestone: 1 }), rejectsWith('ACCOUNT_DELETED'));

  await deletion.requestDeletion({ accountId: 'staff-a', confirmation: 'DELETE MY ACCOUNT' });
  rows = await pool.query('SELECT id, customer_account_id, redeemed_by_account_id FROM badge_coupons ORDER BY id');
  assert.match(rows.rows.find((row) => row.id === leaving.coupon.couponId)!.redeemed_by_account_id, /^deleted:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(rows.rows).includes('leaving-customer'), false);
  assert.equal(JSON.stringify(rows.rows).includes('staff-a'), false);
});

test('real-store visits the customer issued to themself do not count, but demo stores still do', async (t) => {
  const { pool, badges } = await setup(t);
  await addMember(pool, 'real-shop', 'selfie');
  await addMember(pool, 'shop-a', 'selfie');
  // 실제 점포: 본인이 발급한 슬롯 방문 2건은 세지 않고, 다른 점원이 발급한 방문 1건만 센다.
  await addVisit(pool, { account: 'selfie', shop: 'real-shop', date: '2026-09-01', issuedBy: 'selfie' });
  await addVisit(pool, { account: 'selfie', shop: 'real-shop', date: '2026-09-02', issuedBy: 'selfie' });
  await addVisit(pool, { account: 'selfie', shop: 'real-shop', date: '2026-09-03' });
  // 시연 점포: 한 사람이 점원과 고객을 함께 시연하므로 본인 발급도 센다.
  await addVisit(pool, { account: 'selfie', shop: 'shop-a', date: '2026-09-04', issuedBy: 'selfie' });
  const snapshot = await badges.getBadges('selfie');
  assert.deepEqual(snapshot.medals.map(({ kind, value }) => [kind, value]), [
    ['explorer', 2], ['regular', 1], ['steady', 2],
  ]);

  // 본인 발급 방문만 있는 실제 점포는 탐험가에도 들어가지 않는다.
  await addMember(pool, 'real-shop', 'only-self');
  await addVisit(pool, { account: 'only-self', shop: 'real-shop', date: '2026-09-01', issuedBy: 'only-self' });
  assert.deepEqual((await badges.getBadges('only-self')).medals.map(({ value }) => value), [0, 0, 0]);
});

test('a real-store coupon cannot be redeemed by its own owner, while demo stores and other staff still can', async (t) => {
  const db = await setup(t);
  const { pool, badges } = db;
  await addOffer(pool, { milestone: 1, shop: 'real-shop' });
  await addOffer(pool, { milestone: 2, shop: 'shop-a' });
  await addMember(pool, 'real-shop', 'staff-r2');
  await nineTiers(pool, 'staff-r');
  await nineTiers(pool, 'staff-a');
  const realCoupon = await badges.openReward({ accountId: 'staff-r', milestone: 1 });
  const demoCoupon = await badges.openReward({ accountId: 'staff-a', milestone: 2 });

  // 조회는 목록을 그대로 돌려주고 사용 처리에서만 거절한다.
  const ownToken = await identityFor(db, 'staff-r', 'real-shop');
  const listed = await badges.lookupCoupons({ token: ownToken, merchantId: 'real-shop', staffAccountId: 'staff-r' });
  assert.deepEqual(listed.coupons.map((coupon) => coupon.couponId), [realCoupon.coupon.couponId]);
  await assert.rejects(
    badges.redeemCoupon({ token: ownToken, merchantId: 'real-shop', staffAccountId: 'staff-r',
      couponId: realCoupon.coupon.couponId }),
    rejectsWith('COUPON_SELF_REDEEM'),
  );
  assert.equal((await pool.query('SELECT status FROM badge_coupons WHERE id = $1',
    [realCoupon.coupon.couponId])).rows[0]!.status, 'ISSUED');

  // 같은 고객의 QR을 다른 점원이 처리하면 정상 사용된다.
  const created = await db.identities.create('staff-r');
  await db.identities.resolve({ token: created.token, merchantId: 'real-shop', staffAccountId: 'staff-r2' });
  const redeemed = await badges.redeemCoupon({ token: created.token, merchantId: 'real-shop',
    staffAccountId: 'staff-r2', couponId: realCoupon.coupon.couponId });
  assert.equal(redeemed.replayed, false);
  assert.equal((await pool.query('SELECT redeemed_by_account_id FROM badge_coupons WHERE id = $1',
    [realCoupon.coupon.couponId])).rows[0]!.redeemed_by_account_id, 'staff-r2');

  // 시연 점포는 한 사람이 점원과 고객을 함께 시연하므로 본인 쿠폰도 사용 처리된다.
  const demoToken = await identityFor(db, 'staff-a', 'shop-a');
  const demoRedeem = await badges.redeemCoupon({ token: demoToken, merchantId: 'shop-a',
    staffAccountId: 'staff-a', couponId: demoCoupon.coupon.couponId });
  assert.equal(demoRedeem.status, 'REDEEMED');
  assert.equal(demoRedeem.replayed, false);
});

test('a paused offer keeps its opened box and coupon usable while hidden merchants issue nothing new', async (t) => {
  const db = await setup(t);
  const { pool, badges } = db;
  const subject = `admin-${randomUUID()}`;
  const adminAccount = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [subject, adminAccount]);
  const admin = new PostgresAdminService(pool, hmacSecret);
  await admin.grant(subject);
  await addOffer(pool, { milestone: 1, shop: 'real-shop' });
  const pausable = await addOffer(pool, { milestone: 2, shop: 'shop-b' });
  await addOffer(pool, { milestone: 3, shop: 'shop-c' });
  for (const account of ['holder', 'late']) await nineTiers(pool, account);
  const kept = await badges.openReward({ accountId: 'holder', milestone: 2 });
  const heldReal = await badges.openReward({ accountId: 'holder', milestone: 1 });

  // 혜택을 멈춰도 이미 연 상자와 쿠폰은 그대로 사용할 수 있다.
  await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE id = $1`, [pausable]);
  const afterPause = (await badges.getBadges('holder')).rewards[1]!;
  assert.equal(afterPause.state, 'OPENED');
  assert.equal(afterPause.coupon?.couponId, kept.coupon.couponId);
  const pausedToken = await identityFor(db, 'holder', 'shop-b');
  assert.equal((await badges.redeemCoupon({ token: pausedToken, merchantId: 'shop-b', staffAccountId: 'staff-b',
    couponId: kept.coupon.couponId })).status, 'REDEEMED');
  assert.deepEqual((await badges.getBadges('late')).rewards.map((reward) => reward.state),
    ['READY', 'UNAVAILABLE', 'READY']);

  // PAUSED 점포의 혜택은 도감에 보이지 않고 열 수도 없다. 관리자 숨김은 그 점포 혜택을 함께 멈춘다.
  await pool.query(`UPDATE merchants SET status = 'PAUSED' WHERE id = 'shop-c'`);
  const lateBook = await badges.getBadges('late');
  assert.equal(lateBook.rewards[2]!.offer, null);
  assert.equal(lateBook.rewards[2]!.state, 'UNAVAILABLE');
  await assert.rejects(badges.openReward({ accountId: 'late', milestone: 3 }), rejectsWith('REWARD_OFFER_UNAVAILABLE'));

  const hidden = await admin.hideMerchant(adminAccount, 'real-shop', 1);
  assert.equal(hidden.status, 'PAUSED');
  assert.equal((await pool.query(`SELECT status FROM badge_reward_offers WHERE merchant_id = 'real-shop'`)).rows[0]!.status, 'PAUSED');
  assert.equal((await badges.getBadges('late')).rewards[0]!.offer, null);
  await assert.rejects(badges.openReward({ accountId: 'late', milestone: 1 }), rejectsWith('REWARD_OFFER_UNAVAILABLE'));
  const held = (await badges.getBadges('holder')).rewards[0]!;
  assert.equal(held.state, 'OPENED');
  assert.equal(held.coupon?.couponId, heldReal.coupon.couponId);
  assert.equal(held.coupon?.status, 'ISSUED', 'hiding the store does not revoke a coupon that was already opened');
});

test('hiding a merchant while boxes open concurrently never over-issues or deadlocks', async (t) => {
  const { pool, badges } = await setup(t);
  const subject = `admin-${randomUUID()}`;
  const adminAccount = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [subject, adminAccount]);
  const admin = new PostgresAdminService(pool, hmacSecret);
  await admin.grant(subject);
  await addOffer(pool, { milestone: 1, shop: 'real-shop' });
  for (let index = 0; index < 6; index++) await threeTiers(pool, `hide-race-${index}`);
  const outcomes = await Promise.allSettled([
    ...Array.from({ length: 6 }, (_, index) => badges.openReward({ accountId: `hide-race-${index}`, milestone: 1 })),
    admin.hideMerchant(adminAccount, 'real-shop', 1),
  ]);
  const rejected = outcomes.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected.every((result) => result.reason instanceof BadgeRewardError
    && result.reason.code === 'REWARD_OFFER_UNAVAILABLE'), rejected.map((result) => String(result.reason)).join(', '));
  const coupons = (await pool.query('SELECT count(*)::int AS n FROM badge_coupons')).rows[0]!.n;
  const issued = (await pool.query('SELECT issued_count FROM badge_reward_offers')).rows[0]!.issued_count;
  assert.equal(coupons, issued);
  assert.equal((await pool.query(`SELECT status FROM merchants WHERE id = 'real-shop'`)).rows[0]!.status, 'PAUSED');
});

test('lookup and redeem reject expired, revoked, foreign-staff, deleted-customer tokens and revoked staff alike', async (t) => {
  const db = await setup(t);
  const { pool, badges, identities, deletion, state } = db;
  await addOffer(pool, { milestone: 1, shop: 'shop-a' });
  await addMember(pool, 'shop-a', 'staff-a2');
  await nineTiers(pool, 'customer-1');
  const coupon = await badges.openReward({ accountId: 'customer-1', milestone: 1 });
  const attempts = (token: string, staffAccountId = 'staff-a', merchantId = 'shop-a') => [
    () => badges.lookupCoupons({ token, merchantId, staffAccountId }),
    () => badges.redeemCoupon({ token, merchantId, staffAccountId, couponId: coupon.coupon.couponId }),
  ];
  const expectBoth = async (calls: (() => Promise<unknown>)[], code: string) => {
    for (const call of calls) await assert.rejects(call(), rejectsWith(code), code);
  };

  // 만료된 QR
  const expiring = await identities.create('customer-1');
  state.now = new Date(expiring.expiresAt);
  await expectBoth(attempts(expiring.token), 'CUSTOMER_IDENTITY_EXPIRED');
  state.now = new Date('2026-09-29T00:00:00.000Z');

  // 폐기된 QR
  const revoked = await identities.create('customer-1');
  await identities.revoke({ token: revoked.token, accountId: 'customer-1' });
  await expectBoth(attempts(revoked.token), 'CUSTOMER_IDENTITY_UNAVAILABLE');

  // 같은 점포의 다른 점원에 이미 묶인 QR
  const bound = await identities.create('customer-1');
  await badges.lookupCoupons({ token: bound.token, merchantId: 'shop-a', staffAccountId: 'staff-a' });
  await expectBoth(attempts(bound.token, 'staff-a2'), 'CUSTOMER_IDENTITY_UNAVAILABLE');

  // 존재하지 않는 QR
  await expectBoth(attempts('masscom-customer:v1:abcdefghijklmnopqrstuvwxyz0123456789ZZZZZZZ'),
    'CUSTOMER_IDENTITY_UNAVAILABLE');

  // 회수된 점원 멤버십
  const forStaff = await identities.create('customer-1');
  await addMember(pool, 'shop-a', 'staff-a2', 'REVOKED');
  await expectBoth(attempts(forStaff.token, 'staff-a2'), 'MERCHANT_ACCESS_DENIED');

  // 삭제된 고객: 정상 삭제는 QR 행을 지우므로 사용 불가, 삭제 직후 경합으로 QR 행이 남은 경우는 ACCOUNT_DELETED
  await nineTiers(pool, 'leaving');
  const ownToken = await identities.create('leaving');
  await deletion.requestDeletion({ accountId: 'leaving', confirmation: 'DELETE MY ACCOUNT' });
  await expectBoth(attempts(ownToken.token), 'CUSTOMER_IDENTITY_UNAVAILABLE');
  const orphan = 'masscom-customer:v1:abcdefghijklmnopqrstuvwxyz0123456789ORPHAN1';
  await pool.query(
    `INSERT INTO customer_identity_tokens (token_hash, customer_account_id, expires_at, created_at)
     VALUES ($1, 'leaving', $2, $3)`,
    [hashCustomerIdentityToken(orphan), new Date(state.now.getTime() + 120_000), state.now],
  );
  await expectBoth(attempts(orphan), 'ACCOUNT_DELETED');
  assert.equal((await pool.query('SELECT status FROM badge_coupons WHERE id = $1',
    [coupon.coupon.couponId])).rows[0]!.status, 'ISSUED', 'no rejected attempt changed the coupon');
});

test('a coupon stays usable through the last KST day it is labelled with and expires at the next KST midnight', async (t) => {
  const db = await setup(t);
  const { pool, badges, state } = db;
  await addOffer(pool, { milestone: 1, shop: 'shop-a', validDays: 30 });
  await addOffer(pool, { milestone: 2, shop: 'shop-b', validDays: 30 });
  await nineTiers(pool, 'customer-1');
  // 2026-09-29 14:00 KST에 발급하면 마지막 날은 10월 29일이고 23:59:59.999 KST까지다.
  state.now = new Date('2026-09-29T05:00:00.000Z');
  const first = await badges.openReward({ accountId: 'customer-1', milestone: 1 });
  const second = await badges.openReward({ accountId: 'customer-1', milestone: 2 });
  assert.equal(first.coupon.expiresAt, '2026-10-29T14:59:59.999Z');
  assert.equal(second.coupon.expiresAt, '2026-10-29T14:59:59.999Z');

  state.now = new Date('2026-10-29T14:30:00.000Z');
  const evening = await identityFor(db, 'customer-1', 'shop-a');
  const listed = await badges.lookupCoupons({ token: evening, merchantId: 'shop-a', staffAccountId: 'staff-a' });
  assert.deepEqual(listed.coupons.map((coupon) => coupon.couponId), [first.coupon.couponId]);
  assert.equal((await badges.redeemCoupon({ token: evening, merchantId: 'shop-a', staffAccountId: 'staff-a',
    couponId: first.coupon.couponId })).status, 'REDEEMED');
  assert.equal((await badges.getBadges('customer-1')).rewards[1]!.coupon?.status, 'ISSUED');

  state.now = new Date('2026-10-29T15:00:00.000Z');
  const midnight = await identityFor(db, 'customer-1', 'shop-b');
  assert.deepEqual((await badges.lookupCoupons({ token: midnight, merchantId: 'shop-b', staffAccountId: 'staff-b' })).coupons, []);
  await assert.rejects(badges.redeemCoupon({ token: midnight, merchantId: 'shop-b', staffAccountId: 'staff-b',
    couponId: second.coupon.couponId }), rejectsWith('COUPON_EXPIRED'));
  assert.equal((await badges.getBadges('customer-1')).rewards[1]!.coupon?.status, 'EXPIRED');
});
