// #333: 시연 전부 체험의 방문 쪽 — 시연 서버가 옵션을 켠 PostgresClaimSlotService에서만, 그리고 시연 테스트 방문 발급자 슬롯에만
// 방문 날짜를 서로 다른 날로 옮겨 세는지, 그 밖의 모든 경로(직원 발급 슬롯, 옵션을 켜지 않은 서비스)는 지금까지와 같은지 확인한다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import {
  seedLocalShowcase,
  SHOWCASE_CAMPAIGN_ID,
  SHOWCASE_MERCHANT_ID,
  SHOWCASE_STAFF_ACCOUNT_ID,
} from './local-seed.js';

const referenceHmacSecret = 'test-only-all-access-reference-secret-32-bytes';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh masscom_showcase_ci_<uuid>_test database, migrated and seeded with the three local demo merchants. */
async function withFreshShowcaseDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must end in _test');
  }
  const admin = new Pool({ connectionString });
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      await runMigrations(pool);
      await seedLocalShowcase(pool);
      await run(pool);
    } finally {
      await pool.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
}

// 오늘 한국 날짜의 정오를 한 번만 계산한다(실행 중 한국 자정을 넘어도 시계가 하루 뛰지 않게).
function kstNoonToday(): Date {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 3));
}
const testNow = kstNoonToday();

function kstDateOf(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function service(pool: Pool, options: { showcase?: boolean } = {}): PostgresClaimSlotService {
  return new PostgresClaimSlotService(pool, {
    referenceHmacSecret,
    now: () => testNow,
    ...(options.showcase ? { showcaseTestVisitBackdating: true } : {}),
  });
}

async function testVisit(svc: PostgresClaimSlotService, accountId: string, merchantId = SHOWCASE_MERCHANT_ID) {
  const issued = await svc.issueShowcaseTestSlot({ merchantId, accountId });
  return svc.redeem({ accountId, token: issued.token });
}

type VisitRow = { business_date: string; occurred_at: Date; progress_counted: boolean };

async function visitsOf(pool: Pool, accountId: string, merchantId = SHOWCASE_MERCHANT_ID): Promise<VisitRow[]> {
  return (await pool.query<VisitRow>(
    `SELECT business_date::text, occurred_at, progress_counted FROM visit_events
     WHERE customer_account_id = $1 AND merchant_id = $2 ORDER BY occurred_at DESC, id`,
    [accountId, merchantId],
  )).rows;
}

test('(a) a showcase-configured service counts five consecutive test visits on five distinct days and grants goals 1, 3 and 5', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, { showcase: true });
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await testVisit(svc, 'customer-a'));

    assert.deepEqual(results.map((result) => result.visit.progressCounted), [true, true, true, true, true]);
    assert.deepEqual(results.map((result) => result.visit.progressVisitCount), [1, 2, 3, 4, 5]);
    assert.deepEqual(
      results.map((result) => result.grantedRewards.map((reward) => reward.targetVisitCount)),
      [[1], [], [3], [], [5]],
    );

    const expectedDates = [0, 1, 2, 3, 4].map((back) => kstDateOf(testNow.getTime() - back * DAY_MS));
    assert.deepEqual(results.map((result) => result.visit.businessDate), expectedDates);

    const visits = await visitsOf(pool, 'customer-a');
    assert.equal(visits.length, 5);
    assert.ok(visits.every((visit) => visit.progress_counted));
    assert.equal(new Set(visits.map((visit) => visit.business_date)).size, 5);
    // 오늘 방문은 지금 시각 그대로이고, 옮긴 방문은 같은 한국 시각이라 하루씩 정확히 앞선다.
    assert.deepEqual(
      visits.map((visit) => visit.occurred_at.getTime()),
      [0, 1, 2, 3, 4].map((back) => testNow.getTime() - back * DAY_MS),
    );

    const entitlements = await pool.query<{ target_visit_count: number; status: string; earned_at: Date; claim_expires_at: Date }>(
      `SELECT target_visit_count, status, earned_at, claim_expires_at FROM reward_entitlements
       WHERE customer_account_id = 'customer-a' AND campaign_id = $1 ORDER BY target_visit_count`,
      [SHOWCASE_CAMPAIGN_ID],
    );
    assert.deepEqual(entitlements.rows.map((row) => [row.target_visit_count, row.status]), [
      [1, 'GRANTED'], [3, 'GRANTED'], [5, 'GRANTED'],
    ]);
    // 보상권의 획득 시각·수령 기한은 옮기지 않은 실제 수령 시각(testNow)과 90일 기한이다.
    assert.ok(entitlements.rows.every((row) =>
      row.earned_at.getTime() === testNow.getTime() &&
      row.claim_expires_at.getTime() === testNow.getTime() + 90 * DAY_MS));
    const slots = await pool.query<{ claimed_at: Date }>(
      `SELECT claimed_at FROM claim_slots WHERE customer_account_id = 'customer-a'`,
    );
    assert.ok(slots.rows.every((row) => row.claimed_at.getTime() === testNow.getTime()));
  });
});

test('(a) the dates are chosen per account and per store, so other accounts and other stores start from today again', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, { showcase: true });
    await testVisit(svc, 'customer-a');
    const secondOfA = await testVisit(svc, 'customer-a');
    assert.equal(secondOfA.visit.businessDate, kstDateOf(testNow.getTime() - DAY_MS));
    const otherAccount = await testVisit(svc, 'customer-b');
    assert.equal(otherAccount.visit.businessDate, kstDateOf(testNow.getTime()));
    assert.equal(otherAccount.visit.progressCounted, true);
    const otherStore = await testVisit(svc, 'customer-a', 'showcase-local-merchant-b');
    assert.equal(otherStore.visit.businessDate, kstDateOf(testNow.getTime()));
    assert.equal(otherStore.visit.progressCounted, true);
    assert.equal(otherStore.visit.progressVisitCount, 1);
  });
});

test('(a) a canceled visit frees its date again, because only VALID counted visits occupy a day', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, { showcase: true });
    await testVisit(svc, 'customer-a');
    await testVisit(svc, 'customer-a');
    await pool.query(
      `UPDATE visit_events SET status = 'CANCELED', cancellation_reason = '시험 취소', canceled_at = $2
       WHERE customer_account_id = 'customer-a' AND business_date = $1::date`,
      [kstDateOf(testNow.getTime()), testNow],
    );
    const third = await testVisit(svc, 'customer-a');
    assert.equal(third.visit.businessDate, kstDateOf(testNow.getTime()));
    assert.equal(third.visit.progressCounted, true);
    assert.equal(third.visit.progressVisitCount, 2, 'yesterday stays counted and the freed date counts again');
  });
});

test('(a) after 30 distinct days the next test visit falls back to now and, like today, does not count', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, { showcase: true });
    for (let i = 0; i < 30; i += 1) {
      const result = await testVisit(svc, 'customer-a');
      assert.equal(result.visit.progressCounted, true, `visit ${i + 1}`);
    }
    const extra = await testVisit(svc, 'customer-a');
    assert.equal(extra.visit.progressCounted, false);
    assert.equal(extra.visit.businessDate, kstDateOf(testNow.getTime()));
    assert.equal(extra.grantedRewards.length, 0);
    const visits = await visitsOf(pool, 'customer-a');
    assert.equal(visits.length, 31);
    assert.equal(visits.filter((visit) => visit.progress_counted).length, 30);
    // 가장 먼 날은 오늘로부터 29일 전이다.
    assert.equal(
      visits.filter((visit) => visit.progress_counted).at(-1)?.business_date,
      kstDateOf(testNow.getTime() - 29 * DAY_MS),
    );
  });
});

test('(a) a visit never lands before the campaign start, down to the time of day', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    // 어제 18:00(한국)에 시작한 캠페인: "어제 정오"는 시작 전이라 오늘만 센다 → 둘째 방문은 세어지지 않는다.
    const startedYesterdayEvening = new Date(testNow.getTime() - DAY_MS + 6 * 60 * 60 * 1000);
    await pool.query('UPDATE campaigns SET starts_at = $1 WHERE id = $2', [startedYesterdayEvening, SHOWCASE_CAMPAIGN_ID]);
    const svc = service(pool, { showcase: true });
    const first = await testVisit(svc, 'customer-a');
    const second = await testVisit(svc, 'customer-a');
    assert.equal(first.visit.progressCounted, true);
    assert.equal(second.visit.progressCounted, false);

    // 어제 06:00(한국)에 시작한 캠페인: "어제 정오"는 시작 뒤라 어제까지 센다 → 셋째 방문부터 세어지지 않는다.
    const startedYesterdayMorning = new Date(testNow.getTime() - DAY_MS - 6 * 60 * 60 * 1000);
    await pool.query('UPDATE campaigns SET starts_at = $1 WHERE id = $2', [startedYesterdayMorning, SHOWCASE_CAMPAIGN_ID]);
    const other = await testVisit(svc, 'customer-b');
    const otherSecond = await testVisit(svc, 'customer-b');
    const otherThird = await testVisit(svc, 'customer-b');
    assert.deepEqual(
      [other, otherSecond, otherThird].map((result) => [result.visit.businessDate, result.visit.progressCounted]),
      [
        [kstDateOf(testNow.getTime()), true],
        [kstDateOf(testNow.getTime() - DAY_MS), true],
        [kstDateOf(testNow.getTime()), false],
      ],
    );
    const starts = (await pool.query<{ starts_at: Date }>('SELECT starts_at FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID])).rows[0]!.starts_at;
    for (const visit of await visitsOf(pool, 'customer-b')) assert.ok(visit.occurred_at.getTime() >= starts.getTime());
  });
});

test('(a) a test-issuer slot at a store that is no longer is_demo is never backdated, even with the showcase option on', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, { showcase: true });
    const first = await testVisit(svc, 'customer-a');
    assert.equal(first.visit.progressCounted, true);
    const issued = await svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-a' });
    // 발급 뒤 점포가 가상이 아니게 되는 상황(있어서는 안 되지만 마지막 방어선): 수령은 날짜를 옮기지 않는다.
    await pool.query('UPDATE merchants SET is_demo = false WHERE id = $1', [SHOWCASE_MERCHANT_ID]);
    const second = await svc.redeem({ accountId: 'customer-a', token: issued.token });
    assert.equal(second.visit.progressCounted, false);
    assert.equal(second.visit.businessDate, kstDateOf(testNow.getTime()));
    assert.equal(second.grantedRewards.length, 0);
    const visits = await visitsOf(pool, 'customer-a');
    assert.equal(visits.length, 2);
    assert.ok(visits.every((visit) => visit.occurred_at.getTime() === testNow.getTime()));
  });
});

test('(b) a normal staff-issued slot redeemed twice on the same day still yields one counted visit', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    // 기본 서비스(옵션 없음)와 시연 옵션을 켠 서비스 둘 다 직원 발급 슬롯은 지금 시각 그대로다.
    for (const [accountId, svc] of [
      ['customer-plain', service(pool)],
      ['customer-showcase', service(pool, { showcase: true })],
    ] as const) {
      const results = [];
      for (const reference of ['ref-1', 'ref-2']) {
        const issued = await svc.issue({
          merchantId: SHOWCASE_MERCHANT_ID,
          customerAccountId: accountId,
          merchantReference: `${accountId}-${reference}`,
          createdByAccountId: SHOWCASE_STAFF_ACCOUNT_ID,
        });
        results.push(await svc.redeem({ accountId, token: issued.token }));
      }
      assert.deepEqual(results.map((result) => result.visit.progressCounted), [true, false], accountId);
      assert.deepEqual(results.map((result) => result.visit.businessDate), [
        kstDateOf(testNow.getTime()), kstDateOf(testNow.getTime()),
      ]);
      assert.deepEqual(results.map((result) => result.grantedRewards.length), [1, 0]);
      const visits = await visitsOf(pool, accountId);
      assert.equal(visits.length, 2);
      assert.equal(visits.filter((visit) => visit.progress_counted).length, 1);
      assert.ok(visits.every((visit) => visit.occurred_at.getTime() === testNow.getTime()));
    }
  });
});

test('(b) without the showcase option even a test-issuer slot keeps the same-day rule (operating default is untouched)', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool);
    const first = await testVisit(svc, 'customer-a');
    const second = await testVisit(svc, 'customer-a');
    assert.deepEqual([first, second].map((result) => result.visit.progressCounted), [true, false]);
    const visits = await visitsOf(pool, 'customer-a');
    assert.ok(visits.every((visit) => visit.occurred_at.getTime() === testNow.getTime()));
  });
});

test('(seed) a fresh seed spans 30 days back to 30 days ahead; a re-seed widens an older-seeded campaign but never shortens one, and the same moment is idempotent', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const period = async (): Promise<Map<string, [number, number]>> => new Map(
      (await pool.query<{ id: string; starts_at: Date; ends_at: Date }>('SELECT id, starts_at, ends_at FROM campaigns ORDER BY id')).rows
        .map((row) => [row.id, [row.starts_at.getTime(), row.ends_at.getTime()]]),
    );
    const fresh = await period();
    assert.equal(fresh.size, 3);
    for (const [starts, ends] of fresh.values()) {
      assert.ok(starts <= Date.now() - 30 * DAY_MS, 'at least 30 days in the past');
      assert.ok(starts > Date.now() - 30 * DAY_MS - 60_000, 'and only just that far');
      assert.ok(ends > Date.now() + 30 * DAY_MS - 60_000 && ends <= Date.now() + 30 * DAY_MS, 'ends 30 days ahead');
    }

    // 옛 시드(시작 = 시드 시각 - 24시간, 끝이 곧 다가옴)와 이미 더 넓은 기간을 가진 캠페인을 흉내 낸다.
    const reseedNow = new Date();
    const oldStartB = reseedNow.getTime() - DAY_MS;
    const soonEndB = reseedNow.getTime() + 5 * DAY_MS;
    const earlierStartC = reseedNow.getTime() - 90 * DAY_MS;
    const laterEndC = reseedNow.getTime() + 90 * DAY_MS;
    await pool.query('UPDATE campaigns SET starts_at = $2, ends_at = $3 WHERE id = $1',
      ['showcase-local-campaign-b', new Date(oldStartB), new Date(soonEndB)]);
    await pool.query('UPDATE campaigns SET starts_at = $2, ends_at = $3 WHERE id = $1',
      ['showcase-local-campaign-c', new Date(earlierStartC), new Date(laterEndC)]);
    const others = async () => (await pool.query(
      'SELECT id, status, is_public, enrollment_capacity, enrolled_count FROM campaigns ORDER BY id',
    )).rows;
    const othersBefore = await others();

    await seedLocalShowcase(pool, reseedNow);
    const reseeded = await period();
    const b = reseeded.get('showcase-local-campaign-b')!;
    assert.equal(b[0], reseedNow.getTime() - 30 * DAY_MS, 'the old 24h-back campaign starts 30 days back');
    assert.equal(b[1], reseedNow.getTime() + 30 * DAY_MS, 'and ends 30 days ahead instead of 5');
    assert.deepEqual(reseeded.get('showcase-local-campaign-c'), [earlierStartC, laterEndC], 'a wider period is never shortened');
    const a = reseeded.get(SHOWCASE_CAMPAIGN_ID)!;
    assert.equal(a[0], fresh.get(SHOWCASE_CAMPAIGN_ID)![0], 'a campaign already starting 30 days back keeps its start');
    assert.equal(a[1], reseedNow.getTime() + 30 * DAY_MS, 'and its end only moves later (the clock moved on a few ms)');
    assert.ok(a[1] >= fresh.get(SHOWCASE_CAMPAIGN_ID)![1]);
    assert.deepEqual(await others(), othersBefore, 'nothing but starts_at/ends_at changes');

    // 같은 시각의 두 번째 재시드는 아무것도 바꾸지 않는다(멱등). 더 늦은 시각의 재시드는 끝만 더 뒤로 민다.
    await seedLocalShowcase(pool, reseedNow);
    assert.deepEqual(await period(), reseeded);
    const later = new Date(reseedNow.getTime() + DAY_MS);
    await seedLocalShowcase(pool, later);
    const slid = await period();
    for (const [id, [starts, ends]] of slid) {
      assert.equal(starts, reseeded.get(id)![0], `${id} start is never moved later`);
      assert.ok(ends >= reseeded.get(id)![1], `${id} end is never moved earlier`);
    }
    assert.equal(slid.get('showcase-local-campaign-b')![1], later.getTime() + 30 * DAY_MS);
  });
});

test('(seed) a campaign that already ended is still refused instead of being silently revived', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(`UPDATE campaigns SET ends_at = now() - interval '1 day' WHERE id = $1`, [SHOWCASE_CAMPAIGN_ID]);
    const before = (await pool.query('SELECT id, starts_at, ends_at FROM campaigns ORDER BY id')).rows;
    await assert.rejects(seedLocalShowcase(pool), /SHOWCASE_FIXTURE_COLLISION/);
    assert.deepEqual((await pool.query('SELECT id, starts_at, ends_at FROM campaigns ORDER BY id')).rows, before);
  });
});
