import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { MileageShopError } from './mileage-shop.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresMileageShopService } from './postgres/mileage-shop.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { runMigrations } from './postgres/migrate.js';

const hmacSecret = 'test-only-mileage-shop-account-secret-at-least-32-bytes';

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE account_deletion_requests, mileage_spends, account_characters, account_profile,
       reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns,
       merchants CASCADE`,
  );
  const state = { now: new Date('2026-10-01T00:00:00.000Z') };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  return {
    pool,
    state,
    shop: new PostgresMileageShopService(pool, { now, accountLifecycle: lifecycle }),
    reversals: new PostgresReversalService(pool, { labelHmacSecret: hmacSecret, accountLifecycle: lifecycle, now }),
    deletion: new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', now, accountLifecycle: lifecycle,
    }),
  };
}

const rejectsWith = (code: string) => ({ code });

async function addMerchant(pool: Pool, id: string, options: { isDemo?: boolean } = {}): Promise<void> {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', $3)`,
    [id, `가상 ${id}`, options.isDemo ?? true],
  );
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, 'staff', 'STAFF', 'ACTIVE')`, [id]);
}

async function addCampaign(pool: Pool, merchant: string, input: {
  campaignId?: string; status?: string; isPublic?: boolean;
} = {}): Promise<string> {
  const campaignId = input.campaignId ?? `campaign-${merchant}`;
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', $3, $4, 20)`,
    [campaignId, merchant, input.status ?? 'ACTIVE', input.isPublic ?? true],
  );
  return campaignId;
}

// 배지 집계 시험(badge-rewards.postgres.integration.ts)과 같은 모양의 방문 고정값이다. issuedBy가 account와
// 같으면(실제 점포에서) 자기 적립이라 countedVisitFilterSql이 제외한다.
async function addVisit(pool: Pool, input: {
  account: string; merchant: string; campaignId?: string; date: string;
  status?: 'VALID' | 'CANCELED'; counted?: boolean; issuedBy?: string;
}): Promise<string> {
  const visitId = randomUUID();
  const claimSlotId = randomUUID();
  const at = `${input.date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes',
               $7, $7::timestamptz - interval '5 minutes', $7)`,
    [claimSlotId, input.merchant, input.account, randomBytes(32), input.issuedBy ?? 'staff', randomBytes(32), at],
  );
  const canceled = input.status === 'CANCELED';
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at, business_date,
       verification_level, status, progress_counted, cancellation_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', $8, $9, $10)`,
    [visitId, claimSlotId, input.merchant, input.campaignId ?? `campaign-${input.merchant}`, input.account, at,
      input.date, canceled ? 'CANCELED' : 'VALID', input.counted ?? true, canceled ? '시험 취소' : null],
  );
  return visitId;
}

async function completeSeries(pool: Pool, input: {
  account: string; campaignId: string; sourceVisitEventId: string; statuses?: ('GRANTED' | 'MINT_REQUESTED' | 'FULFILLED' | 'CANCELED')[];
}): Promise<void> {
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, 1, '첫'), ($1, 3, '셋'), ($1, 5, '다섯')
     ON CONFLICT DO NOTHING`,
    [input.campaignId],
  );
  const statuses = input.statuses ?? ['GRANTED', 'GRANTED', 'GRANTED'];
  const targets = [1, 3, 5] as const;
  for (let index = 0; index < targets.length; index++) {
    await pool.query(
      `INSERT INTO reward_entitlements (
         id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
         status, policy_version, earned_at, claim_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
      [randomUUID(), input.account, input.campaignId, targets[index], input.sourceVisitEventId, statuses[index]],
    );
  }
}

test('earned mileage reuses the badge aggregate\'s counted-visit set: duplicates, self-issued and reversed visits are excluded, promoted visits still count', async (t) => {
  const { pool, shop, reversals, state } = await setup(t);
  await addMerchant(pool, 'shop-a', { isDemo: true });
  await addMerchant(pool, 'shop-b', { isDemo: false });
  await addCampaign(pool, 'shop-a');
  await addCampaign(pool, 'shop-b');

  await addVisit(pool, { account: 'c1', merchant: 'shop-a', date: '2026-09-01' });
  const day2 = await addVisit(pool, { account: 'c1', merchant: 'shop-a', date: '2026-09-02' });
  // 같은 날 두 번째 방문(중복)은 진행에 세지 않는다 — countedVisits에 들어오지 않는다.
  const dup = await addVisit(pool, { account: 'c1', merchant: 'shop-a', date: '2026-09-02', counted: false });
  // 실제 점포(is_demo=false)에서 본인이 발급한 수령 슬롯의 방문(자기 적립)은 counted여도 제외된다.
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ('shop-b', 'c1', 'STAFF', 'ACTIVE')`);
  await addVisit(pool, { account: 'c1', merchant: 'shop-b', date: '2026-09-03', issuedBy: 'c1' });

  // countedVisits=2(9/1, 9/2), distinctMerchants=1(shop-a만, shop-b는 자기 적립이라 제외) → 50*2 + 100*1 = 200.
  const before = await shop.getShop('c1');
  assert.equal(before.mileage.earned, 200);
  assert.equal(before.mileage.spent, 0);
  assert.equal(before.mileage.balance, 200);
  assert.deepEqual(before.mileage.rules, { visit: 50, newStore: 100, series: 200 });

  // 9/2 셈 방문을 되돌리면 같은 날 가려졌던 정당한 중복 방문이 승격돼 countedVisits 총량은 그대로다.
  state.now = new Date('2026-09-02T12:00:00.000Z');
  await reversals.cancelVisit({ merchantId: 'shop-a', staffAccountId: 'staff', visitEventId: day2, reason: 'OTHER' });
  const promoted = await pool.query<{ progress_counted: boolean }>(
    'SELECT progress_counted FROM visit_events WHERE id = $1', [dup],
  );
  assert.equal(promoted.rows[0]!.progress_counted, true, 'the duplicate visit must be promoted');
  const after = await shop.getShop('c1');
  assert.equal(after.mileage.earned, 200, 'earned is recomputed live and unaffected by the promotion');
});

test('completed store series counts once per merchant, for any campaign including ended/unpublished ones, only with non-revoked entitlements for every goal', async (t) => {
  const { pool, shop } = await setup(t);
  await addMerchant(pool, 'shop-c');
  // 끝났고(ENDED) 비공개(is_public=false)인 캠페인도 센다 — 공개 카탈로그 조건을 보지 않는다.
  const campaignId = await addCampaign(pool, 'shop-c', { status: 'ENDED', isPublic: false });
  const sourceVisit = await addVisit(pool, { account: 'c2', merchant: 'shop-c', campaignId, date: '2026-09-01', counted: false });
  await completeSeries(pool, { account: 'c2', campaignId, sourceVisitEventId: sourceVisit });

  const snapshot = await shop.getShop('c2');
  // countedVisits=0(그 방문은 counted:false), distinctMerchants=0, completedSeries=1 → 200.
  assert.equal(snapshot.mileage.earned, 200);

  // 목표 하나가 빠지면(5회 미달) 아직 완성이 아니다.
  await addMerchant(pool, 'shop-d');
  const campaignD = await addCampaign(pool, 'shop-d');
  const sourceD = await addVisit(pool, { account: 'c3', merchant: 'shop-d', campaignId: campaignD, date: '2026-09-01', counted: false });
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1,1,'첫'),($1,3,'셋'),($1,5,'다섯')`,
    [campaignD],
  );
  for (const target of [1, 3] as const) {
    await pool.query(
      `INSERT INTO reward_entitlements (
         id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
         status, policy_version, earned_at, claim_expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'GRANTED', 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')`,
      [randomUUID(), 'c3', campaignD, target, sourceD],
    );
  }
  assert.equal((await shop.getShop('c3')).mileage.earned, 0, 'missing goal 5 means the series is not complete');

  // 모든 목표가 있어도 하나가 철회(CANCELED)되면 완성이 아니다.
  await addMerchant(pool, 'shop-e');
  const campaignE = await addCampaign(pool, 'shop-e');
  const sourceE = await addVisit(pool, { account: 'c4', merchant: 'shop-e', campaignId: campaignE, date: '2026-09-01', counted: false });
  await completeSeries(pool, {
    account: 'c4', campaignId: campaignE, sourceVisitEventId: sourceE,
    statuses: ['GRANTED', 'CANCELED', 'GRANTED'],
  });
  assert.equal((await shop.getShop('c4')).mileage.earned, 0, 'a revoked entitlement blocks series completion');
});

test('reroll is idempotent by (account, requestId), rejects a grade mismatch replay, and enforces expectedRemaining/completeness/balance in order', async (t) => {
  const { pool, shop } = await setup(t);
  // 5개 점포 각 1방문: countedVisits=5, distinctMerchants=5 → earned = 50*5 + 100*5 = 750.
  for (let index = 0; index < 5; index++) {
    await addMerchant(pool, `rich-${index}`);
    await addCampaign(pool, `rich-${index}`);
    await addVisit(pool, { account: 'roller', merchant: `rich-${index}`, date: '2026-09-01' });
  }
  assert.equal((await shop.getShop('roller')).mileage.earned, 750);

  const first = await shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r1', expectedRemaining: 3 });
  assert.equal(first.replayed, false);
  assert.equal(first.balance, 650);
  assert.equal((await shop.getShop('roller')).grades.find((g) => g.grade === 'BRONZE')?.owned, 1);

  const replay = await shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r1', expectedRemaining: 3 });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.item, first.item);
  assert.equal(replay.balance, 650, 'replay reports the current balance, not a new charge');

  await assert.rejects(
    shop.reroll({ accountId: 'roller', grade: 'SILVER', requestId: 'r1', expectedRemaining: 3 }),
    rejectsWith('SHOP_REQUEST_CONFLICT'),
  );

  // 클라이언트가 본 remaining(3)이 지금(2)과 다르면 돈을 받지 않고 거절한다.
  await assert.rejects(
    shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r2', expectedRemaining: 3 }),
    rejectsWith('SHOP_STATE_CHANGED'),
  );
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mileage_spends')).rows[0]!.n, 1, 'no charge on a rejected request');

  const second = await shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r2', expectedRemaining: 2 });
  assert.notEqual(second.item.id, first.item.id);
  const third = await shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r3', expectedRemaining: 1 });
  assert.notEqual(third.item.id, first.item.id);
  assert.notEqual(third.item.id, second.item.id);

  await assert.rejects(
    shop.reroll({ accountId: 'roller', grade: 'BRONZE', requestId: 'r4', expectedRemaining: 0 }),
    rejectsWith('SHOP_GRADE_COMPLETE'),
  );

  await assert.rejects(
    shop.reroll({ accountId: 'poor', grade: 'GOLD', requestId: 'p1', expectedRemaining: 3 }),
    rejectsWith('SHOP_INSUFFICIENT_MILEAGE'),
  );
});

test('concurrent rerolls on one account never overspend or double-assign', async (t) => {
  const { pool, shop } = await setup(t);
  for (let index = 0; index < 3; index++) {
    await addMerchant(pool, `race-${index}`);
    await addCampaign(pool, `race-${index}`);
    await addVisit(pool, { account: 'racer', merchant: `race-${index}`, date: '2026-09-01' });
  }
  // earned = 50*3 + 100*3 = 450, enough for every bronze item (100 each) with room to spare.
  assert.equal((await shop.getShop('racer')).mileage.earned, 450);

  // 여러 클라이언트가 같은 화면(remaining=3)을 보고 동시에 서로 다른 requestId로 누른 상황: 계정 잠금이
  // 모두 직렬화하므로 딱 하나만 통과하고 나머지는 상태가 바뀐 것을 그대로 보고하며 과금되지 않는다.
  const stale = await Promise.allSettled(
    Array.from({ length: 5 }, (_, index) =>
      shop.reroll({ accountId: 'racer', grade: 'BRONZE', requestId: `stale-${index}`, expectedRemaining: 3 })),
  );
  assert.equal(stale.filter((result) => result.status === 'fulfilled').length, 1);
  const staleRejections = stale.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.equal(staleRejections.length, 4);
  assert.ok(staleRejections.every((result) => result.reason instanceof MileageShopError
    && result.reason.code === 'SHOP_STATE_CHANGED'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mileage_spends')).rows[0]!.n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_characters')).rows[0]!.n, 1);

  // 같은 requestId로 동시에 여러 번 와도(네트워크 재시도) 한 장만 만든다.
  const sameRequest = await Promise.all(
    Array.from({ length: 8 }, () =>
      shop.reroll({ accountId: 'racer', grade: 'SILVER', requestId: 'dup-request', expectedRemaining: 3 })),
  );
  assert.equal(sameRequest.filter((result) => !result.replayed).length, 1);
  assert.equal(new Set(sameRequest.map((result) => result.item.id)).size, 1);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM mileage_spends WHERE request_id = $1', ['dup-request'])).rows[0]!.n,
    1,
  );
  // 앞의 BRONZE 1장 + 이 SILVER 1장, 그 이상은 없다(동시 중복 요청이 한 번만 적용됐다는 뜻).
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_characters WHERE account_id = $1', ['racer'])).rows[0]!.n, 2);
});

test('a reversal that pushes the balance negative blocks further purchases but never takes back owned items', async (t) => {
  const { pool, shop, reversals, state } = await setup(t);
  await addMerchant(pool, 'shop-g');
  await addCampaign(pool, 'shop-g');
  const visit = await addVisit(pool, { account: 'unlucky', merchant: 'shop-g', date: '2026-09-01' });
  // earned = 50*1 + 100*1 = 150, enough for one bronze item (100).
  const first = await shop.reroll({ accountId: 'unlucky', grade: 'BRONZE', requestId: 'u1', expectedRemaining: 3 });
  assert.equal(first.balance, 50);

  state.now = new Date('2026-09-01T12:00:00.000Z');
  await reversals.cancelVisit({ merchantId: 'shop-g', staffAccountId: 'staff', visitEventId: visit, reason: 'OTHER' });
  // earned은 이제 0, spent는 100 그대로라 잔액은 -100.
  const afterReversal = await shop.getShop('unlucky');
  assert.equal(afterReversal.mileage.earned, 0);
  assert.equal(afterReversal.mileage.balance, -100);
  assert.equal(afterReversal.grades.find((g) => g.grade === 'BRONZE')?.owned, 1, '이미 받은 캐릭터는 되가져가지 않는다');

  await assert.rejects(
    shop.reroll({ accountId: 'unlucky', grade: 'BRONZE', requestId: 'u2', expectedRemaining: 2 }),
    rejectsWith('SHOP_INSUFFICIENT_MILEAGE'),
  );
});

test('setAvatar requires ownership, accepts null to clear, and account deletion cleans up all three tables including the avatar', async (t) => {
  const { pool, shop, deletion } = await setup(t);
  await addMerchant(pool, 'shop-h');
  await addCampaign(pool, 'shop-h');
  await addVisit(pool, { account: 'dresser', merchant: 'shop-h', date: '2026-09-01' });
  const got = await shop.reroll({ accountId: 'dresser', grade: 'BRONZE', requestId: 'd1', expectedRemaining: 3 });

  // bakery-squirrel은 SILVER 카탈로그라 BRONZE 재뽑기 하나만 한 이 계정은 가질 수 없다(뽑힌 품목과 무관하게 확정).
  await assert.rejects(
    shop.setAvatar({ accountId: 'dresser', itemId: 'bakery-squirrel' }),
    rejectsWith('SHOP_ITEM_NOT_OWNED'),
  );
  assert.deepEqual(await shop.setAvatar({ accountId: 'dresser', itemId: got.item.id }), { avatar: got.item.id });
  assert.equal((await shop.getShop('dresser')).avatar, got.item.id);
  assert.deepEqual(await shop.setAvatar({ accountId: 'dresser', itemId: null }), { avatar: null });
  await shop.setAvatar({ accountId: 'dresser', itemId: got.item.id });

  await deletion.requestDeletion({ accountId: 'dresser', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mileage_spends WHERE account_id = $1', ['dresser'])).rows[0]!.n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_characters WHERE account_id = $1', ['dresser'])).rows[0]!.n, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM account_profile WHERE account_id = $1', ['dresser'])).rows[0]!.n, 0);
  await assert.rejects(
    shop.reroll({ accountId: 'dresser', grade: 'BRONZE', requestId: 'd2', expectedRemaining: 2 }),
    rejectsWith('ACCOUNT_DELETED'),
  );
});

test('history pages recent spends newest-first with a cursor and surfaces the same earned/spent/balance as the shop snapshot', async (t) => {
  const { pool, shop } = await setup(t);
  await addMerchant(pool, 'shop-i');
  await addCampaign(pool, 'shop-i');
  await addVisit(pool, { account: 'historian', merchant: 'shop-i', date: '2026-09-01' });
  await shop.reroll({ accountId: 'historian', grade: 'BRONZE', requestId: 'h1', expectedRemaining: 3 });
  const history = await shop.getHistory({ accountId: 'historian' });
  assert.equal(history.spends.length, 1);
  assert.equal(history.nextCursor, null);
  assert.equal(history.mileage.earned, (await shop.getShop('historian')).mileage.earned);
  // 잘못된 형식·빈 커서는 DB 오류(500)가 아니라 잘못된 요청으로 거절한다.
  for (const cursor of ['not-a-uuid', '']) {
    await assert.rejects(shop.getHistory({ accountId: 'historian', cursor }), { code: 'INVALID_REQUEST' });
  }
  assert.equal(history.mileage.balance, (await shop.getShop('historian')).mileage.balance);

  await assert.rejects(
    shop.getHistory({ accountId: 'historian', cursor: randomUUID() }),
    rejectsWith('INVALID_REQUEST'),
  );
});
