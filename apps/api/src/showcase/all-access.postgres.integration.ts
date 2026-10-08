// #333: 시연 전부 체험의 방문 쪽 — 시연 서버가 옵션을 켠 PostgresClaimSlotService에서만, 그리고 시연 테스트 방문 발급자 슬롯에만
// 방문 날짜를 서로 다른 날로 옮겨 세는지, 그 밖의 모든 경로(직원 발급 슬롯, 옵션을 켜지 않은 서비스)는 지금까지와 같은지 확인한다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool, type PoolClient } from 'pg';

import type { CollectibleArtwork, CollectibleProject } from '../collectible-project.js';
import { collectibleSnapshot, validateCollectibleProject } from '../collectible-project-rules.js';
import { runMigrations } from '../postgres/migrate.js';
import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import { PostgresCollectionReader } from '../postgres/collection.js';
import { PostgresCollectibleProjectService } from '../postgres/collectible-project.js';
import {
  seedLocalShowcase,
  SHOWCASE_CAMPAIGN_ID,
  SHOWCASE_MERCHANT_ID,
  SHOWCASE_STAFF_ACCOUNT_ID,
} from './local-seed.js';
import { storeCollectibleArt } from './store-collectible-art.js';
import { seedStoreCollectibles, storeCollectibleProject, type StoreCollectibleTarget } from './store-collectibles.js';

const referenceHmacSecret = 'test-only-all-access-reference-secret-32-bytes';
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh masscom_showcase_ci_<uuid>_test database, migrated and seeded with all demo merchants. */
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
    assert.equal(fresh.size, 33);
    assert.equal([SHOWCASE_CAMPAIGN_ID, 'showcase-local-campaign-b', 'showcase-local-campaign-c']
      .filter((id) => fresh.has(id)).length, 3);
    assert.equal([...fresh.keys()].filter((id) => id.startsWith('showcase-wolgye-')).length, 30);
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

// ---- R-333a, #365: 시연 가상 점포 수집품의 세 등급(A/B 골드, C 프리즘) ----
// 호스트 시드(seedShowcaseFixtureData 'hosted')는 DB 이름이 masscom_showcase일 때만 돌아 이 일회용 DB에서는 부를 수 없으므로,
// 그 안에서 부르는 seedStoreCollectibles를 같은 거래 방식으로 직접 부른다(같은 함수·같은 대상 모양).
const collectibleTargets: StoreCollectibleTarget[] = [
  { merchantId: SHOWCASE_MERCHANT_ID, campaignId: SHOWCASE_CAMPAIGN_ID, storeName: '가상 점포 A', art: 'a' },
  { merchantId: 'showcase-local-merchant-b', campaignId: 'showcase-local-campaign-b', storeName: '가상 점포 B', art: 'b' },
  { merchantId: 'showcase-local-merchant-c', campaignId: 'showcase-local-campaign-c', storeName: '가상 점포 C', art: 'c', topGrade: 'prism' },
];

async function inTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const seedCollectibles = (pool: Pool, targets: readonly StoreCollectibleTarget[] = collectibleTargets) =>
  inTransaction(pool, (client) => seedStoreCollectibles(client, targets, new Date()));

/** #322가 처음 시드하던 모양 그대로의 단일 등급(bronze '체험') 수집품. 이미 배포된 시연 DB가 가진 옛 시드 게시물을 흉내 낸다. */
function legacySingleGradeProject(target: StoreCollectibleTarget): CollectibleProject {
  const { image, thumbnail } = storeCollectibleArt[target.art];
  return {
    schemaVersion: 2, name: `${target.storeName} 방문 수집품`, campaignId: target.campaignId, theme: { name: '체험 방문 도감' },
    photo: { originalDataUrl: image, width: 512, height: 512 }, shape: 'circle', crop: { x: 0, y: 0, zoom: 1 },
    photoEdits: { brightness: 0, contrast: 0, merge: 0, simplify: 0, cartoon: 0, strokes: [] },
    style: 'original', baseColor: '#bf8149', photoColor: 100, relief: 45, stickers: [],
    back: { mode: 'default', color: '#bf8149', stickers: [] },
    grades: [{ id: 'bronze', name: '체험', kind: 'basic', enabled: true }],
    effects: [], motion: [], thickness: 8, angle: 0,
    greeting: '시연용 가상 점포 수집품입니다.', greetingOverrides: [], audio: null,
    story: { type: 'zoom', frames: [], cartoon: 0, strength: 50 },
    parallax: { strength: 0, strokes: [] }, living: { periodMs: 2400, items: [] },
    derived: { bronze: { imageDataUrl: image, thumbnailDataUrl: thumbnail } },
    rewardGrades: { 1: 'bronze', 3: 'bronze', 5: 'bronze' },
  } as CollectibleProject;
}

type PublicationFixture = {
  // 점주 편집기로 만든 게시물처럼 작성자 열을 채운다(같은 이름·테마여도 시드 것이 아니다).
  createdBy?: string;
  editedBy?: string;
  // 옛 시드 모양에서 한 가지씩만 어긋나게 만든다(식별 조건을 하나씩 고정하는 시험용).
  mutate?: (project: CollectibleProject) => void;
  // #365 이전 C 시드가 발행하던 bronze/silver/gold 프로젝트를 그대로 재현한다.
  project?: CollectibleProject;
  // false면 게시물만 만들고 캠페인 연결은 걸지 않는다.
  link?: boolean;
};

/** 옛 시드 게시물(또는 그것을 한 가지만 어긋나게 만든 것)을 주어진 연결(거래)로 넣는다. 거래 시작·끝은 호출자가 정한다. */
async function insertPublicationRows(client: PoolClient, target: StoreCollectibleTarget, options: PublicationFixture = {}): Promise<string> {
  const draft = options.project ?? legacySingleGradeProject(target);
  options.mutate?.(draft);
  const project = validateCollectibleProject(draft, true);
  const projectId = randomUUID();
  const publicationId = randomUUID();
  await client.query(
    `INSERT INTO collectible_projects (id, merchant_id, created_by_account_id, edited_by_account_id, project, name, lineage_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $1)`,
    [projectId, target.merchantId, options.createdBy ?? null, options.editedBy ?? null, JSON.stringify(project), project.name]);
  await client.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, $3, $4, 1, $5::jsonb)`,
    [publicationId, projectId, target.merchantId, target.campaignId, JSON.stringify(project.rewardGrades)]);
  // 꺼진 등급은 발행 스냅샷이 없다(실제 게시와 같다).
  for (const { id: gradeId } of project.grades.filter((grade) => grade.enabled)) {
    const { projectId: _p, publicationId: _u, gradeId: _g, gradeName, shape, theme, name, thumbnailDataUrl, ...detail } =
      collectibleSnapshot(project, projectId, publicationId, gradeId);
    const summary: CollectibleArtwork = { projectId, publicationId, gradeId, gradeName, shape, theme, name, thumbnailDataUrl };
    await client.query(
      'INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail) VALUES ($1, $2, $3::jsonb, $4::jsonb)',
      [publicationId, gradeId, JSON.stringify(summary), JSON.stringify(detail)]);
  }
  if (options.link !== false) {
    await client.query('INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)', [target.campaignId, publicationId]);
  }
  await client.query(`UPDATE collectible_projects SET status = 'PUBLISHED', publication_id = $2, version = 2 WHERE id = $1`, [projectId, publicationId]);
  return publicationId;
}

const insertLegacyPublication = (pool: Pool, target: StoreCollectibleTarget, options: PublicationFixture = {}): Promise<string> =>
  inTransaction(pool, (client) => insertPublicationRows(client, target, options));

function previousThreeGradeProject(target: StoreCollectibleTarget): CollectibleProject {
  const project = storeCollectibleProject({ ...target, topGrade: 'gold' });
  assert.deepEqual(project.grades, [
    { id: 'bronze', name: '브론즈', kind: 'basic', enabled: true },
    { id: 'silver', name: '실버', kind: 'special', enabled: true },
    { id: 'gold', name: '골드', kind: 'special', enabled: true },
  ], 'the fixture matches the previous seed grade array exactly');
  return project;
}

function modernMerchantPublishProject(target: StoreCollectibleTarget): CollectibleProject {
  const project = storeCollectibleProject({ ...target, topGrade: 'gold' });
  const prism = { id: 'prism', name: '프리즘', kind: 'special' as const, enabled: true };
  project.grades = [...project.grades, prism];
  project.derived.prism = { ...project.derived.gold! };
  return project;
}

/** 다른 연결이 잠금을 기다리는 중이 될 때까지 기다린다(경합 시험에서 시드가 막혔음을 확인하는 데만 쓴다). */
async function waitUntilSomeoneBlocks(pool: Pool): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await pool.query(
      `SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
    if (waiting.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the seed never blocked on the concurrent writer');
}

async function waitUntilTwoBlockOrWorkFinishes(pool: Pool, finished: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (finished()) return;
    const waiting = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
    if (waiting.rows[0]!.total >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the two concurrent operations never reached their lock gate');
}

async function collectibleCounts(pool: Pool): Promise<number[]> {
  const tables = ['collectible_projects', 'collectible_publications', 'collectible_publication_grades', 'campaign_collectible_publications'];
  const [results, wolgye] = await Promise.all([Promise.all(tables.map((table) =>
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${table}`))), Promise.all([
    pool.query<{ total: number }>("SELECT count(*)::int AS total FROM collectible_projects WHERE merchant_id LIKE 'showcase-wolgye-%'"),
    pool.query<{ total: number }>("SELECT count(*)::int AS total FROM collectible_publications WHERE merchant_id LIKE 'showcase-wolgye-%'"),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM collectible_publication_grades grade
      JOIN collectible_publications publication ON publication.id = grade.publication_id
      WHERE publication.merchant_id LIKE 'showcase-wolgye-%'`),
    pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM campaign_collectible_publications link
      JOIN campaigns campaign ON campaign.id = link.campaign_id
      WHERE campaign.merchant_id LIKE 'showcase-wolgye-%'`),
  ])]);
  const baseline = [30, 30, 90, 30];
  assert.deepEqual(wolgye.map(({ rows }) => rows[0]!.total), baseline);
  return results.map(({ rows }, index) => rows[0]!.total - baseline[index]!);
}

async function linkedPublication(pool: Pool, campaignId: string): Promise<string> {
  return (await pool.query<{ publication_id: string }>(
    'SELECT publication_id FROM campaign_collectible_publications WHERE campaign_id = $1', [campaignId])).rows[0]!.publication_id;
}

async function gradesOf(pool: Pool, publicationId: string): Promise<{ grade_id: string; grade_name: string; animation: string }[]> {
  return (await pool.query<{ grade_id: string; grade_name: string; animation: string }>(
    `SELECT grade_id, summary ->> 'gradeName' AS grade_name, detail ->> 'animation' AS animation
     FROM collectible_publication_grades WHERE publication_id = $1 ORDER BY grade_id`, [publicationId])).rows;
}

test('(R-333a, #365) a fresh collectible seed publishes gold for A/B and prism for C at the fifth visit', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    assert.equal((await seedCollectibles(pool)).length, 3);
    assert.deepEqual(await collectibleCounts(pool), [3, 3, 9, 3]);
    for (const target of collectibleTargets) {
      const publicationId = await linkedPublication(pool, target.campaignId);
      const publication = (await pool.query<{ reward_grades: Record<string, string> }>(
        'SELECT reward_grades FROM collectible_publications WHERE id = $1', [publicationId])).rows[0]!;
      const topGrade = target.art === 'c' ? 'prism' : 'gold';
      assert.deepEqual(publication.reward_grades, { 1: 'bronze', 3: 'silver', 5: topGrade });
      assert.deepEqual(await gradesOf(pool, publicationId), [
        { grade_id: 'bronze', grade_name: '브론즈', animation: 'still' },
        { grade_id: topGrade, grade_name: topGrade === 'prism' ? '프리즘' : '골드', animation: 'sparkle' },
        { grade_id: 'silver', grade_name: '실버', animation: 'shine' },
      ]);
    }
    // DEMO_RUNBOOK의 "재시드 뒤 확인" 질의가 그대로 동작하고 점포마다 목표 1·3·5에 맞는 세 등급을 돌려준다.
    const runbookCheck = await pool.query<{ campaign_id: string; grades: string[] }>(
      `SELECT link.campaign_id, array_agg(grade.grade_id ORDER BY grade.grade_id) AS grades
       FROM campaign_collectible_publications link
       JOIN collectible_publication_grades grade ON grade.publication_id = link.publication_id
       WHERE link.campaign_id IN ('showcase-local-campaign', 'showcase-local-campaign-b', 'showcase-local-campaign-c')
       GROUP BY link.campaign_id ORDER BY link.campaign_id`);
    assert.deepEqual(runbookCheck.rows.map((row) => [row.campaign_id, row.grades]), [
      ['showcase-local-campaign', ['bronze', 'gold', 'silver']],
      ['showcase-local-campaign-b', ['bronze', 'gold', 'silver']],
      ['showcase-local-campaign-c', ['bronze', 'prism', 'silver']],
    ]);
    // 두 번 돌려도(이미 3등급으로 걸려 있음) 아무것도 더하지 않는다.
    assert.deepEqual(await seedCollectibles(pool), []);
    assert.deepEqual(await collectibleCounts(pool), [3, 3, 9, 3]);
  });
});

test('(R-333a) five showcase test visits yield a bronze, a silver and a gold collectible from the same store', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedCollectibles(pool);
    const svc = service(pool, { showcase: true });
    for (let i = 0; i < 5; i += 1) await testVisit(svc, 'customer-a');
    const collection = await new PostgresCollectionReader(pool).getCollection('customer-a');
    const byGoal = Object.fromEntries(collection.collectibles.map((item) => [item.targetVisitCount, item.artwork]));
    assert.deepEqual(
      [1, 3, 5].map((goal) => [byGoal[goal]?.gradeId, byGoal[goal]?.gradeName]),
      [['bronze', '브론즈'], ['silver', '실버'], ['gold', '골드']],
    );
    assert.equal(new Set(collection.collectibles.map((item) => item.artwork?.publicationId)).size, 1);
  });
});

test('(R-333a) a re-seed upgrades the old single-grade seed link exactly once, keeps old acquisitions on their snapshot, and a second re-seed is a no-op', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const [storeA, storeB, storeC] = collectibleTargets as [StoreCollectibleTarget, StoreCollectibleTarget, StoreCollectibleTarget];
    // 배포된 시연 DB의 모양: 세 점포 모두 옛 단일 등급 게시물이 걸려 있다. 한 고객은 그 게시물로 1회 보상을 이미 받았다.
    const legacy = { a: await insertLegacyPublication(pool, storeA), b: await insertLegacyPublication(pool, storeB), c: await insertLegacyPublication(pool, storeC) };
    assert.deepEqual(await collectibleCounts(pool), [3, 3, 3, 3]);
    const early = service(pool, { showcase: true });
    const firstVisit = await testVisit(early, 'early-customer');
    assert.equal(firstVisit.grantedRewards.length, 1);
    const oldRows = async () => (await pool.query(
      `SELECT to_jsonb(publication) AS publication,
              (SELECT jsonb_agg(to_jsonb(grade) ORDER BY grade.grade_id) FROM collectible_publication_grades grade WHERE grade.publication_id = publication.id) AS grades,
              (SELECT to_jsonb(project) FROM collectible_projects project WHERE project.id = publication.project_id) AS project
       FROM collectible_publications publication WHERE publication.id = ANY($1::uuid[]) ORDER BY publication.id`,
      [Object.values(legacy)])).rows;
    const oldBefore = await oldRows();
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM collectible_acquisitions')).rows[0]!.n, 1);

    // 첫 재시드: 세 점포 모두 3등급 게시물로 한 번 갈아 끼워진다.
    assert.deepEqual((await seedCollectibles(pool)).sort(), collectibleTargets.map((target) => target.campaignId).sort());
    assert.deepEqual(await collectibleCounts(pool), [6, 6, 12, 3]);
    const upgraded: Record<string, string> = {};
    for (const [key, target] of [['a', storeA], ['b', storeB], ['c', storeC]] as const) {
      upgraded[key] = await linkedPublication(pool, target.campaignId);
      assert.notEqual(upgraded[key], legacy[key], `${key} now points at a new publication`);
      assert.deepEqual((await gradesOf(pool, upgraded[key]!)).map((grade) => grade.grade_id),
        key === 'c' ? ['bronze', 'prism', 'silver'] : ['bronze', 'gold', 'silver']);
    }
    // 옛 게시물·프로젝트·등급 행은 한 글자도 바뀌지 않고, 이미 받은 획득은 옛 스냅샷을 그대로 가리킨다.
    assert.deepEqual(await oldRows(), oldBefore);
    const early1 = await new PostgresCollectionReader(pool).getCollection('early-customer');
    assert.equal(early1.collectibles[0]?.artwork?.publicationId, legacy.a);
    assert.equal(early1.collectibles[0]?.artwork?.gradeName, '체험');
    // 새 방문은 새 3등급 게시물을 잡는다(1회 보상은 브론즈).
    const later = await testVisit(service(pool, { showcase: true }), 'new-customer');
    assert.equal(later.grantedRewards.length, 1);
    const fresh = await new PostgresCollectionReader(pool).getCollection('new-customer');
    assert.deepEqual([fresh.collectibles[0]?.artwork?.publicationId, fresh.collectibles[0]?.artwork?.gradeId], [upgraded.a, 'bronze']);

    // 두 번째·세 번째 재시드는 아무것도 바꾸지 않는다.
    const linksAfterFirst = (await pool.query('SELECT campaign_id, publication_id FROM campaign_collectible_publications ORDER BY campaign_id')).rows;
    assert.deepEqual(await seedCollectibles(pool), []);
    assert.deepEqual(await seedCollectibles(pool), []);
    assert.deepEqual(await collectibleCounts(pool), [6, 6, 12, 3]);
    assert.deepEqual((await pool.query('SELECT campaign_id, publication_id FROM campaign_collectible_publications ORDER BY campaign_id')).rows, linksAfterFirst);
  });
});

test('(#365) re-seeding the previous three-grade C seed swaps only C once and preserves issued gold snapshots', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const [storeA, storeB, storeC] = collectibleTargets as [StoreCollectibleTarget, StoreCollectibleTarget, StoreCollectibleTarget];
    assert.deepEqual(await seedCollectibles(pool, [storeA, storeB]), [storeA.campaignId, storeB.campaignId]);
    const previous = await insertLegacyPublication(pool, storeC, { project: previousThreeGradeProject(storeC) });
    const oldRows = async () => (await pool.query(
      `SELECT to_jsonb(publication) AS publication,
              (SELECT jsonb_agg(to_jsonb(grade) ORDER BY grade.grade_id) FROM collectible_publication_grades grade WHERE grade.publication_id = publication.id) AS grades,
              (SELECT to_jsonb(project) FROM collectible_projects project WHERE project.id = publication.project_id) AS project
       FROM collectible_publications publication WHERE publication.id = $1`, [previous])).rows;
    const previousBefore = await oldRows();
    const unchangedA = await linkedPublication(pool, storeA.campaignId);
    const unchangedB = await linkedPublication(pool, storeB.campaignId);
    const oldService = service(pool, { showcase: true });
    for (let i = 0; i < 5; i += 1) await testVisit(oldService, 'old-c-customer', storeC.merchantId);
    const oldCollection = await new PostgresCollectionReader(pool).getCollection('old-c-customer');
    const oldGold = oldCollection.collectibles.find((item) => item.targetVisitCount === 5)?.artwork;
    assert.deepEqual([oldGold?.publicationId, oldGold?.gradeId, oldGold?.gradeName], [previous, 'gold', '골드']);

    assert.deepEqual(await seedCollectibles(pool), [storeC.campaignId]);
    const replacement = await linkedPublication(pool, storeC.campaignId);
    assert.notEqual(replacement, previous);
    assert.equal(await linkedPublication(pool, storeA.campaignId), unchangedA);
    assert.equal(await linkedPublication(pool, storeB.campaignId), unchangedB);
    assert.deepEqual(await collectibleCounts(pool), [4, 4, 12, 3]);
    assert.deepEqual((await gradesOf(pool, replacement)).map((grade) => [grade.grade_id, grade.grade_name]),
      [['bronze', '브론즈'], ['prism', '프리즘'], ['silver', '실버']]);
    assert.deepEqual(await oldRows(), previousBefore, 'old immutable publication and project rows are unchanged');
    const after = await new PostgresCollectionReader(pool).getCollection('old-c-customer');
    const retained = after.collectibles.find((item) => item.targetVisitCount === 5)?.artwork;
    assert.deepEqual([retained?.publicationId, retained?.gradeId, retained?.gradeName], [previous, 'gold', '골드']);
    assert.deepEqual(await seedCollectibles(pool), []);
    assert.equal(await linkedPublication(pool, storeC.campaignId), replacement);
    assert.deepEqual(await collectibleCounts(pool), [4, 4, 12, 3]);
  });
});

test('(#365) C publications with a merchant author or other grades are never replaced', async () => {
  for (const options of [
    { createdBy: 'owner-1' },
    { editedBy: 'owner-1' },
    { mutate: (project: CollectibleProject) => { project.grades[2]!.name = '점주 골드'; } },
  ]) {
    await withFreshShowcaseDatabase(async (pool) => {
      const storeC = collectibleTargets[2]!;
      const previous = await insertLegacyPublication(pool, storeC, {
        project: previousThreeGradeProject(storeC), ...options,
      });
      const before = await collectibleCounts(pool);
      assert.deepEqual(await seedCollectibles(pool, [storeC]), []);
      assert.equal(await linkedPublication(pool, storeC.campaignId), previous);
      assert.deepEqual(await collectibleCounts(pool), before);
    });
  }
});

test('(R-333a) a merchant-authored publication, even with the seed\'s name and one grade, is never replaced; only the seed\'s own is', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const [storeA, storeB] = collectibleTargets as [StoreCollectibleTarget, StoreCollectibleTarget, StoreCollectibleTarget];
    // 점포 A: 점주 계정이 만든(작성자 열이 채워진) 게시물이 같은 이름·같은 단일 등급이어도 시드 것이 아니다.
    const authored = await insertLegacyPublication(pool, storeA, { createdBy: 'owner-1' });
    // 점포 B: 시드가 직접 넣은(작성자 열이 빈) 옛 게시물.
    const seedOwned = await insertLegacyPublication(pool, storeB);
    const authoredRows = async () => (await pool.query(
      `SELECT to_jsonb(project) AS project, to_jsonb(publication) AS publication
       FROM collectible_projects project JOIN collectible_publications publication ON publication.project_id = project.id
       WHERE publication.id = $1`, [authored])).rows;
    const authoredBefore = await authoredRows();

    const published = await seedCollectibles(pool);
    assert.deepEqual(published.sort(), ['showcase-local-campaign-c', 'showcase-local-campaign-b'].sort(), 'B upgraded, C is new, A left alone');
    assert.equal(await linkedPublication(pool, storeA.campaignId), authored, 'the merchant-authored link is untouched');
    assert.notEqual(await linkedPublication(pool, storeB.campaignId), seedOwned);
    assert.deepEqual(await authoredRows(), authoredBefore);
    // 시작은 A·B 옛 게시물 각 1(프로젝트 2·게시물 2·등급 2). 거기에 B 업그레이드 1세트(3등급)와 C 신규 1세트(3등급)만 더해지고
    // A에는 새 행이 하나도 생기지 않는다.
    assert.deepEqual(await collectibleCounts(pool), [2 + 2, 2 + 2, 2 + 3 + 3, 3]);
    assert.deepEqual(await seedCollectibles(pool), []);
  });
});

test('(R-333a) a seed publication whose media was removed by an operator is not touched either', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const legacy = await insertLegacyPublication(pool, storeA);
    await inTransaction(pool, async (client) => {
      await client.query(`SET LOCAL masscom.collectible_media_removal = 'on'`);
      await client.query('UPDATE collectible_publications SET media_removed_at = now() WHERE id = $1', [legacy]);
    });
    const before = await collectibleCounts(pool);
    const published = await seedCollectibles(pool, [storeA]);
    assert.deepEqual(published, [], 'a removed publication is not silently replaced by the seed');
    assert.deepEqual(await collectibleCounts(pool), before);
    assert.equal(await linkedPublication(pool, storeA.campaignId), legacy);
  });
});

test('(R-333a race) a merchant publish that commits while the seed waits is never overwritten by the seed', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const merchant = await pool.connect();
    try {
      // 점주 게시와 같은 순서: 캠페인 행을 FOR UPDATE로 잠그고(아직 연결이 없음) 새 게시물을 넣어 연결하지만 아직 커밋하지 않는다.
      await merchant.query('BEGIN');
      await merchant.query('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [storeA.campaignId]);
      const authored = await insertPublicationRows(merchant, storeA, { createdBy: 'owner-1', mutate: (project) => { project.name = '점주가 만든 수집품'; } });
      const seeding = seedCollectibles(pool, [storeA]).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
      await waitUntilSomeoneBlocks(pool);
      await merchant.query('COMMIT');
      const outcome = await seeding;
      assert.deepEqual(outcome, { ok: true, value: [] }, 'the seed sees the merchant link after the lock and leaves it alone');
      assert.equal(await linkedPublication(pool, storeA.campaignId), authored, 'the merchant link survives');
      assert.deepEqual(await collectibleCounts(pool), [1, 1, 1, 1], 'and the seed added nothing');
    } finally {
      merchant.release();
    }
  });
});

test('(R-333 round 3) full re-seed and real merchant publish finish without deadlock when old merchant metadata needs backfill', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const projects = new PostgresCollectibleProjectService(pool);
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ($1, 'showcase-race-owner', 'OWNER', 'ACTIVE')`, [storeA.merchantId]);
    const draft = await projects.create({
      merchantId: storeA.merchantId, accountId: 'showcase-race-owner', project: modernMerchantPublishProject(storeA),
    });
    await pool.query('UPDATE merchants SET neighborhood = NULL, category = NULL WHERE id = ANY($1::text[])',
      [collectibleTargets.map((target) => target.merchantId)]);
    await pool.query(
      `UPDATE campaigns SET starts_at = now() - interval '1 day', ends_at = now() + interval '1 day' WHERE id = $1`,
      [storeA.campaignId]);

    // AFTER 트리거는 캠페인 행 잠금이 잡힌 뒤 시드를 멈춘다.
    await pool.query(`CREATE FUNCTION showcase_campaign_race_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(333596::bigint);
        IF EXISTS (SELECT 1 FROM merchants
                   WHERE id IN ('showcase-local-merchant', 'showcase-local-merchant-b', 'showcase-local-merchant-c')
                     AND (neighborhood IS NULL OR category IS NULL)) THEN
          RAISE EXCEPTION 'SHOWCASE_MERCHANT_BACKFILL_ORDER';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER showcase_campaign_race_gate AFTER UPDATE OF starts_at, ends_at ON campaigns
      FOR EACH ROW WHEN (NEW.id = 'showcase-local-campaign') EXECUTE FUNCTION showcase_campaign_race_gate()`);
    const gate = await pool.connect();
    const pending: Promise<unknown>[] = [];
    let gateOpen = false;
    try {
      await gate.query('BEGIN');
      gateOpen = true;
      await gate.query('SELECT pg_advisory_xact_lock(333596::bigint)');
      const reseeding = seedLocalShowcase(pool, new Date());
      pending.push(reseeding);
      reseeding.catch(() => undefined);
      await waitUntilSomeoneBlocks(pool);
      const publishing = projects.publish({
        merchantId: storeA.merchantId, accountId: 'showcase-race-owner', projectId: draft.id,
        expectedVersion: 1, campaignId: storeA.campaignId,
      });
      pending.push(publishing);
      publishing.catch(() => undefined);
      await waitUntilTwoBlockOrWorkFinishes(pool, () => false);
      await gate.query('COMMIT');
      gateOpen = false;
      const [seedResult, publishResult] = await Promise.allSettled([reseeding, publishing]);
      assert.equal(seedResult.status, 'fulfilled', 'the full re-seed completes without 40P01');
      assert.equal(publishResult.status, 'fulfilled', 'real publish completes without 40P01');
      if (publishResult.status !== 'fulfilled') return;
      assert.equal(await linkedPublication(pool, storeA.campaignId), publishResult.value.publicationId);
      assert.deepEqual((await gradesOf(pool, publishResult.value.publicationId)).map((grade) => grade.grade_id),
        ['bronze', 'gold', 'prism', 'silver']);
      const merchant = (await pool.query<{ neighborhood: string; category: string }>(
        'SELECT neighborhood, category FROM merchants WHERE id = $1', [storeA.merchantId])).rows[0]!;
      assert.ok(merchant.neighborhood && merchant.category, 'the legacy merchant metadata was filled');
    } finally {
      if (gateOpen) await gate.query('ROLLBACK');
      await Promise.allSettled(pending);
      gate.release();
    }
  });
});

test('(R-333 round 3) media removal after legacy upgrade also removes the newly linked publication', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const legacy = await insertLegacyPublication(pool, storeA);
    const gate = await pool.connect();
    const pending: Promise<unknown>[] = [];
    let gateOpen = false;
    try {
      await gate.query('BEGIN');
      gateOpen = true;
      await gate.query('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [storeA.campaignId]);
      const upgrading = seedCollectibles(pool, [storeA]);
      pending.push(upgrading);
      upgrading.catch(() => undefined);
      await waitUntilSomeoneBlocks(pool);
      let removalFinished = false;
      const removing = pool.query('SELECT * FROM collectible_remove_publication_media($1)', [legacy])
        .finally(() => { removalFinished = true; });
      pending.push(removing);
      removing.catch(() => undefined);
      await waitUntilTwoBlockOrWorkFinishes(pool, () => removalFinished);
      assert.equal(removalFinished, false, 'removal waits on the upgrade source lock before the gate opens');
      await gate.query('COMMIT');
      gateOpen = false;
      const [upgradeResult, removalResult] = await Promise.allSettled([upgrading, removing]);
      assert.equal(upgradeResult.status, 'fulfilled', 'the upgrade commits before removal');
      if (upgradeResult.status === 'fulfilled') assert.deepEqual(upgradeResult.value, [storeA.campaignId]);
      assert.equal(removalResult.status, 'fulfilled', 'the real removal function completes');
      assert.equal((await pool.query(
        'SELECT 1 FROM campaign_collectible_publications WHERE campaign_id = $1', [storeA.campaignId])).rowCount, 0);
      const publications = await pool.query<{ media_removed_at: Date | null }>(
        'SELECT media_removed_at FROM collectible_publications WHERE campaign_id = $1', [storeA.campaignId]);
      assert.equal(publications.rowCount, 2, 'legacy and upgraded publications both remain as redacted records');
      assert.ok(publications.rows.every((row) => row.media_removed_at !== null));
      assert.equal((await pool.query(
        'SELECT 1 FROM collectible_projects WHERE merchant_id = $1 AND project IS NOT NULL', [storeA.merchantId])).rowCount, 0);
      assert.deepEqual(await seedCollectibles(pool, [storeA]), [], 'a later seed does not restore removed media');
    } finally {
      if (gateOpen) await gate.query('ROLLBACK');
      await Promise.allSettled(pending);
      gate.release();
    }
  });
});

test('(R-333 round 3) legacy upgrade leaves a publication removed first unlinked', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const legacy = await insertLegacyPublication(pool, storeA);
    // 제거 함수가 source 잠금을 가진 채 연결을 끊은 시점에서 멈춘다.
    await pool.query(`CREATE FUNCTION showcase_removal_race_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(333597::bigint); RETURN OLD; END $$`);
    await pool.query(`CREATE TRIGGER showcase_removal_race_gate AFTER DELETE ON campaign_collectible_publications
      FOR EACH ROW EXECUTE FUNCTION showcase_removal_race_gate()`);
    const gate = await pool.connect();
    const pending: Promise<unknown>[] = [];
    let gateOpen = false;
    try {
      await gate.query('BEGIN');
      gateOpen = true;
      await gate.query('SELECT pg_advisory_xact_lock(333597::bigint)');
      const removing = pool.query('SELECT * FROM collectible_remove_publication_media($1)', [legacy]);
      pending.push(removing);
      removing.catch(() => undefined);
      await waitUntilSomeoneBlocks(pool);
      const upgrading = seedCollectibles(pool, [storeA]);
      pending.push(upgrading);
      upgrading.catch(() => undefined);
      await waitUntilTwoBlockOrWorkFinishes(pool, () => false);
      await gate.query('COMMIT');
      gateOpen = false;
      const [removalResult, upgradeResult] = await Promise.allSettled([removing, upgrading]);
      assert.equal(removalResult.status, 'fulfilled', 'the real removal function completes first');
      assert.equal(upgradeResult.status, 'fulfilled', 'the seed skips media already removed');
      if (upgradeResult.status === 'fulfilled') assert.deepEqual(upgradeResult.value, []);
      assert.equal((await pool.query(
        'SELECT 1 FROM campaign_collectible_publications WHERE campaign_id = $1', [storeA.campaignId])).rowCount, 0);
      const removed = await pool.query<{ media_removed_at: Date | null }>(
        'SELECT media_removed_at FROM collectible_publications WHERE id = $1', [legacy]);
      assert.ok(removed.rows[0]?.media_removed_at, 'the original publication media remains removed');
      assert.equal((await pool.query(
        'SELECT 1 FROM collectible_projects WHERE merchant_id = $1 AND project IS NOT NULL', [storeA.merchantId])).rowCount, 0);
      assert.deepEqual(await seedCollectibles(pool, [storeA]), [], 'a later seed does not restore removed media');
    } finally {
      if (gateOpen) await gate.query('ROLLBACK');
      await Promise.allSettled(pending);
      gate.release();
    }
  });
});

test('(R-333a race) a link writer that never locks the campaign itself is still serialized, because its foreign key holds the campaign row', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    // 이미 커밋된, 아직 연결 안 된 점주 게시물을 만들어 두고, 캠페인을 직접 잠그지 않은 채 그 연결 행만 거는 쓰기를 열어 둔다.
    // campaign_collectible_publications.campaign_id의 외래 키가 캠페인 행에 FOR KEY SHARE를 걸므로 시드의 FOR UPDATE가 기다린다.
    // (그래서 "연결이 없다고 읽은 뒤 다른 쓰기가 연결을 거는" 틈은 잠금을 먼저 잡는 한 생기지 않는다. 일반 INSERT는 그래도 남기는 안전망이다.)
    const authored = await insertLegacyPublication(pool, storeA, {
      createdBy: 'owner-1', link: false, mutate: (project) => { project.name = '점주가 만든 수집품'; },
    });
    const before = await collectibleCounts(pool);
    assert.deepEqual(before, [1, 1, 1, 0]);
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)', [storeA.campaignId, authored]);
      const seeding = seedCollectibles(pool, [storeA]).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
      await waitUntilSomeoneBlocks(pool);
      await writer.query('COMMIT');
      assert.deepEqual(await seeding, { ok: true, value: [] }, 'the seed waited, then saw the merchant link and left it alone');
      assert.equal(await linkedPublication(pool, storeA.campaignId), authored);
      assert.deepEqual(await collectibleCounts(pool), [1, 1, 1, 1]);
    } finally {
      writer.release();
    }
  });
});

test('(R-333a race) the legacy re-point is compare-and-swap: a link changed behind the lock makes the whole seed roll back', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const legacy = await insertLegacyPublication(pool, storeA);
    const replacement = await insertLegacyPublication(pool, storeA, {
      createdBy: 'owner-1', link: false, mutate: (project) => { project.name = '점주가 바꾼 수집품'; },
    });
    const before = await collectibleCounts(pool);
    assert.deepEqual(before, [2, 2, 2, 1]);
    // 캠페인 잠금을 쓰지 않는 쓰기(잠금 규칙을 어긴 경로)가 연결을 점주 게시물로 바꾸는 중이다.
    const writer = await pool.connect();
    try {
      await writer.query('BEGIN');
      await writer.query('UPDATE campaign_collectible_publications SET publication_id = $2 WHERE campaign_id = $1', [storeA.campaignId, replacement]);
      const seeding = seedCollectibles(pool, [storeA]).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
      await waitUntilSomeoneBlocks(pool);
      await writer.query('COMMIT');
      const outcome = await seeding;
      assert.equal(outcome.ok, false);
      assert.match(String((outcome as { error: unknown }).error), /SHOWCASE_COLLECTIBLE_LINK_CHANGED/);
      assert.equal(await linkedPublication(pool, storeA.campaignId), replacement, 'the changed link is not overwritten');
      assert.deepEqual(await collectibleCounts(pool), before, 'the seed transaction rolled back, leaving no orphan project, publication or grade rows');
    } finally {
      writer.release();
    }
    // 다음 재시드는 연결이 이제 점주 게시물이라 아무것도 하지 않는다.
    assert.deepEqual(await seedCollectibles(pool, [storeA]), []);
    assert.notEqual(legacy, replacement);
  });
});

test('(R-333a) each condition that identifies the seed\'s own publication is pinned: any one difference leaves the link alone', async () => {
  const variants: [string, PublicationFixture][] = [
    ['created_by only', { createdBy: 'owner-1' }],
    ['edited_by only', { editedBy: 'owner-2' }],
    ['a different project name', { mutate: (project) => { project.name = '다른 이름의 수집품'; } }],
    ['a different theme', { mutate: (project) => { project.theme.name = '다른 도감'; } }],
    ['a different grade name', { mutate: (project) => { project.grades[0]!.name = '다른 등급'; } }],
    ['an extra (disabled) grade', {
      mutate: (project) => {
        project.grades.push({ id: 'extra', name: '추가', kind: 'basic', enabled: false });
        project.derived.extra = { ...project.derived.bronze! };
      },
    }],
  ];
  for (const [label, fixture] of variants) {
    await withFreshShowcaseDatabase(async (pool) => {
      const storeA = collectibleTargets[0]!;
      const publicationId = await insertLegacyPublication(pool, storeA, fixture);
      const before = await collectibleCounts(pool);
      assert.deepEqual(await seedCollectibles(pool, [storeA]), [], label);
      assert.equal(await linkedPublication(pool, storeA.campaignId), publicationId, label);
      assert.deepEqual(await collectibleCounts(pool), before, label);
    });
  }
  // 대조군: 모든 조건이 맞는 옛 시드 게시물은 갈아 끼워진다.
  await withFreshShowcaseDatabase(async (pool) => {
    const storeA = collectibleTargets[0]!;
    const legacy = await insertLegacyPublication(pool, storeA);
    assert.deepEqual(await seedCollectibles(pool, [storeA]), [storeA.campaignId]);
    assert.notEqual(await linkedPublication(pool, storeA.campaignId), legacy);
  });
});

test('(seed) a campaign that started one day ago but ends in 90 days gets an earlier start and keeps its later end', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const seedNow = new Date();
    const end = new Date(seedNow.getTime() + 90 * DAY_MS);
    await pool.query('UPDATE campaigns SET starts_at = $2, ends_at = $3 WHERE id = $1',
      [SHOWCASE_CAMPAIGN_ID, new Date(seedNow.getTime() - DAY_MS), end]);
    await seedLocalShowcase(pool, seedNow);
    const row = (await pool.query<{ starts_at: Date; ends_at: Date }>(
      'SELECT starts_at, ends_at FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID])).rows[0]!;
    assert.equal(row.starts_at.getTime(), seedNow.getTime() - 30 * DAY_MS, 'the start is pulled 30 days back');
    assert.equal(row.ends_at.getTime(), end.getTime(), 'the later end (+90 days) is never pulled in to +30 days');
  });
});
