// Issue #330: 점주 가게 현황(방문 집계 + 오픈 준비 체크리스트)을 실제 PostgreSQL에서 확인한다.
// 핵심은 두 가지다. (1) 방문은 배지·마일리지와 같은 "세어지는 방문" 기준으로 KST 날짜·주 경계에서 센다.
// (2) 체크리스트의 "고객 앱 공개" 단계는 공개 목록(PostgresMerchantCatalog.listPublicMerchants)과 항상 같은 답을 낸다.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { MerchantOverviewError } from './merchant-overview-rules.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { PostgresMerchantOverviewService } from './postgres/merchant-overview.js';
import { runMigrations } from './postgres/migrate.js';

// 이 이슈의 시험 DB 이름은 masscom_test_330이라 다른 파일의 `_test` 끝맺음 검사를 그대로 쓸 수 없다. 이름이 `_test`이거나
// `_test_<숫자>`인 시험 전용 DB만 받는다(운영·시연 DB 이름은 이 모양이 아니다).
const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl !== undefined &&
  /_test(_[0-9]+)?$/.test(decodeURIComponent(new URL(testUrl).pathname.slice(1)));
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';

// 수요일 낮 12시(KST). 이번 주 월요일은 2026-10-05, 지난주 월요일은 2026-09-28이다.
const WEDNESDAY_NOON = '2026-10-07T03:00:00.000Z';

async function setup(t: TestContext, nowIso = WEDNESDAY_NOON) {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  const state = { now: new Date(nowIso) };
  const now = () => state.now;
  return {
    pool, state,
    overview: new PostgresMerchantOverviewService(pool, now),
    catalog: new PostgresMerchantCatalog(pool, now),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

type MerchantSeed = Partial<{
  name: string; roadAddress: string; businessHours: string; menu: { name: string; priceWon: number }[];
  status: 'ACTIVE' | 'PAUSED'; publishedAt: string | null; demo: boolean;
}>;

async function seedMerchant(pool: Pool, id: string, over: MerchantSeed = {}): Promise<string> {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo, menu_items,
       business_hours, published_at)
     VALUES ($1, $2, '', $3, 0, $4, $5, $6::jsonb, $7, $8)`,
    [id, over.name ?? `시험 ${id}`, over.roadAddress ?? '서울 노원구 월계로 1', over.status ?? 'ACTIVE', over.demo ?? false,
      JSON.stringify(over.menu ?? [{ name: '김밥', priceWon: 4500 }]), over.businessHours ?? '월–금 10:00–20:00',
      over.publishedAt === undefined ? '2026-09-01T00:00:00Z' : over.publishedAt]);
  return id;
}

type CampaignSeed = Partial<{
  merchantId: string; title: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED'; isPublic: boolean;
  startsAt: string; endsAt: string; goals: number[]; linked: boolean;
}>;

async function seedCampaign(pool: Pool, id: string, merchantId: string, over: CampaignSeed = {}): Promise<string> {
  const status = over.status ?? 'ACTIVE';
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 50)`,
    [id, merchantId, over.title ?? `캠페인 ${id}`, over.startsAt ?? '2026-09-01T00:00:00Z', over.endsAt ?? '2026-12-31T00:00:00Z',
      status, over.isPublic ?? status === 'ACTIVE']);
  for (const goal of over.goals ?? [1, 3, 5]) {
    await pool.query(`INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ($1, $2, $3)`,
      [id, goal, `${goal}회`]);
  }
  if (over.linked) await linkCollectible(pool, id, merchantId);
  return id;
}

// 발행본 한 건을 만들어 캠페인에 연결한다(연결 행만 있으면 체크리스트가 "수집품 연결됨"으로 본다).
async function linkCollectible(pool: Pool, campaignId: string, merchantId: string): Promise<void> {
  const projectId = randomUUID();
  const publicationId = randomUUID();
  await pool.query(`INSERT INTO collectible_projects (id, merchant_id, lineage_id) VALUES ($1, $2, $1)`, [projectId, merchantId]);
  await pool.query(
    `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
     VALUES ($1, $2, $3, $4, 1, '{"1":"bronze"}'::jsonb)`, [publicationId, projectId, merchantId, campaignId]);
  await pool.query(`INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1, $2)`,
    [campaignId, publicationId]);
}

async function addMember(pool: Pool, merchantId: string, accountId: string, role: 'OWNER' | 'STAFF',
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'): Promise<void> {
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'REVOKED' THEN now() END)`, [merchantId, accountId, role, status]);
}

// 방문 한 건. 수령 슬롯은 slotBy(기본: 그 점포의 시험 직원)가 발급한 것으로 둔다. slotBy가 고객 본인이면 본인 적립이다.
async function addVisit(pool: Pool, input: {
  merchantId: string; campaignId: string; customer: string; date: string; slotBy?: string;
  status?: 'VALID' | 'CANCELED'; counted?: boolean;
}): Promise<void> {
  const slotId = randomUUID();
  const at = `${input.date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes', $7,
       $7::timestamptz - interval '5 minutes', $7)`,
    [slotId, input.merchantId, input.customer, randomBytes(32), input.slotBy ?? `staff-of-${input.merchantId}`, randomBytes(32), at]);
  const canceled = input.status === 'CANCELED';
  await pool.query(
    `INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at,
       business_date, verification_level, status, progress_counted, cancellation_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', $8, $9, $10)`,
    [randomUUID(), slotId, input.merchantId, input.campaignId, input.customer, at, input.date, input.status ?? 'VALID',
      input.counted ?? !canceled, canceled ? 'WRONG_CUSTOMER' : null]);
}

async function seedOffer(pool: Pool, merchantId: string, milestone: 1 | 2 | 3): Promise<string> {
  const id = randomUUID();
  // 멈춘 혜택으로 둔다: 상자마다 활성 혜택은 전체에서 하나라는 유일 제약에 걸리지 않는다.
  await pool.query(
    `INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, status, consent_note)
     VALUES ($1, $2, $3, '음료 1잔', '시험 혜택', 30, 'PAUSED', '시험 동의 기록')`, [id, milestone, merchantId]);
  return id;
}

async function addCoupon(pool: Pool, input: {
  merchantId: string; offerId: string; milestone: 1 | 2 | 3; customer: string; redeemedAt: string | null;
}): Promise<void> {
  const redeemed = input.redeemedAt !== null;
  await pool.query(
    `INSERT INTO badge_coupons (id, customer_account_id, milestone, offer_id, merchant_id, title, detail, status,
       issued_at, expires_at, redeemed_at, redeemed_by_account_id)
     VALUES ($1, $2, $3, $4, $5, '음료 1잔', '시험 쿠폰', $6, '2026-09-01T00:00:00Z', '2027-01-01T00:00:00Z', $7, $8)`,
    [randomUUID(), input.customer, input.milestone, input.offerId, input.merchantId, redeemed ? 'REDEEMED' : 'ISSUED',
      input.redeemedAt, redeemed ? `staff-of-${input.merchantId}` : null]);
}

const customers = { c1: 'cust-1', c2: 'cust-2', c3: 'cust-3', c4: 'cust-4', c5: 'cust-5' } as const;

test('counts only counted visits by KST day and week, with zero-filled 7 days, coupons and repeat visitors', { skip }, async t => {
  const db = await setup(t);
  const { pool } = db;
  await seedMerchant(pool, 'shop-a');
  await seedMerchant(pool, 'shop-b');
  const campaignA = await seedCampaign(pool, 'camp-a', 'shop-a');
  const campaignB = await seedCampaign(pool, 'camp-b', 'shop-b');
  await addMember(pool, 'shop-a', 'owner-a', 'OWNER');
  await addMember(pool, 'shop-a', 'staff-of-shop-a', 'STAFF');
  await addMember(pool, 'shop-a', 'staff-revoked', 'STAFF', 'REVOKED');
  await addMember(pool, 'shop-b', 'staff-of-shop-b', 'STAFF');
  const visit = (customer: string, date: string, over: Partial<Parameters<typeof addVisit>[1]> = {}) =>
    addVisit(pool, { merchantId: 'shop-a', campaignId: campaignA, customer, date, ...over });

  // 세어지는 방문 9건.
  await visit(customers.c1, '2026-10-07');
  await visit(customers.c2, '2026-10-07');
  await visit(customers.c1, '2026-10-06');
  await visit(customers.c4, '2026-10-05'); // 이번 주 월요일
  await visit(customers.c1, '2026-10-04'); // 지난주 일요일
  await visit(customers.c2, '2026-10-04');
  await visit(customers.c5, '2026-09-30');
  await visit(customers.c5, '2026-09-28'); // 지난주 월요일
  await visit(customers.c1, '2026-09-27'); // 지지난주 일요일
  // 세어지지 않는 방문: 취소, 같은 날 두 번째 방문, 직원 본인 적립, 다른 점포의 방문.
  await visit(customers.c3, '2026-10-07', { status: 'CANCELED' });
  await visit(customers.c3, '2026-10-06', { status: 'CANCELED', counted: true });
  await visit(customers.c1, '2026-10-07', { counted: false });
  await visit('staff-of-shop-a', '2026-10-07', { slotBy: 'staff-of-shop-a' });
  await addVisit(pool, { merchantId: 'shop-b', campaignId: campaignB, customer: customers.c1, date: '2026-10-07' });

  const offerA = await seedOffer(pool, 'shop-a', 1);
  const offerB = await seedOffer(pool, 'shop-b', 2);
  await addCoupon(pool, { merchantId: 'shop-a', offerId: offerA, milestone: 1, customer: customers.c1, redeemedAt: '2026-10-06T05:00:00Z' });
  // 일요일 23:59:59 KST는 지난주, 월요일 00:00:00 KST부터 이번 주다.
  await addCoupon(pool, { merchantId: 'shop-a', offerId: offerA, milestone: 1, customer: customers.c2, redeemedAt: '2026-10-04T14:59:59Z' });
  await addCoupon(pool, { merchantId: 'shop-a', offerId: offerA, milestone: 1, customer: customers.c4, redeemedAt: '2026-10-04T15:00:00Z' });
  // 사용 처리를 되돌려 redeemed_at이 비었거나 다른 점포의 쿠폰은 세지 않는다.
  await addCoupon(pool, { merchantId: 'shop-a', offerId: offerA, milestone: 1, customer: customers.c5, redeemedAt: null });
  await addCoupon(pool, { merchantId: 'shop-b', offerId: offerB, milestone: 2, customer: customers.c1, redeemedAt: '2026-10-06T05:00:00Z' });

  const overview = await db.overview.overview({ merchantId: 'shop-a' });
  assert.equal(overview.businessDate, '2026-10-07');
  assert.equal(overview.weekStartsOn, '2026-10-05');
  assert.deepEqual(overview.visits, {
    today: 2, thisWeek: 4, lastWeek: 4, total: 9,
    last7Days: [
      { date: '2026-10-01', count: 0 }, { date: '2026-10-02', count: 0 }, { date: '2026-10-03', count: 0 },
      { date: '2026-10-04', count: 2 }, { date: '2026-10-05', count: 1 }, { date: '2026-10-06', count: 1 },
      { date: '2026-10-07', count: 2 },
    ],
  });
  // 공개 시각(2026-09-01)이 지난주 시작보다 이르므로 비교가 보이고, 지난주 같은 기간(월~수)은 2건이다.
  assert.deepEqual(overview.comparison, { lastWeekSameSpan: 2, delta: 2 });
  assert.equal(overview.couponsRedeemedThisWeek, 2);
  assert.equal(overview.repeatVisitors, 3);
  assert.equal(overview.generatedAt, WEDNESDAY_NOON);

  // 점포 B는 자기 방문 1건·쿠폰 1건만 본다.
  const other = await db.overview.overview({ merchantId: 'shop-b' });
  assert.equal(other.visits.today, 1);
  assert.equal(other.visits.total, 1);
  assert.equal(other.couponsRedeemedThisWeek, 1);
  assert.equal(other.repeatVisitors, 0);
});

test('a store with no visits gets zeros, seven zero days and no comparison without a publish time', { skip }, async t => {
  const db = await setup(t);
  await seedMerchant(db.pool, 'quiet', { publishedAt: null });
  const overview = await db.overview.overview({ merchantId: 'quiet' });
  assert.deepEqual(overview.visits, {
    today: 0, thisWeek: 0, lastWeek: 0, total: 0,
    last7Days: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']
      .map(date => ({ date, count: 0 })),
  });
  assert.equal(overview.comparison, null);
  assert.equal(overview.couponsRedeemedThisWeek, 0);
  assert.equal(overview.repeatVisitors, 0);
  assert.equal(overview.campaign, null);
});

test('week boundaries move at Monday 00:00 KST and the comparison depends on the publish time', { skip }, async t => {
  const db = await setup(t, '2026-10-04T14:59:59.999Z'); // 일요일 23:59:59.999 KST
  const { pool } = db;
  // 이 시각의 지난주 시작은 2026-09-21 00:00 KST(= 2026-09-20T15:00Z)다.
  await seedMerchant(pool, 'old', { publishedAt: '2026-09-20T15:00:00Z' }); // 정각에 공개: 비교가 보인다
  await seedMerchant(pool, 'late', { publishedAt: '2026-09-20T15:00:00.001Z' }); // 1밀리초 늦게 공개: 숨긴다
  await seedMerchant(pool, 'fresh', { publishedAt: '2026-10-01T00:00:00Z' }); // 이번 주에 공개
  for (const id of ['old', 'late', 'fresh']) {
    const campaign = await seedCampaign(pool, `camp-${id}`, id);
    await addMember(pool, id, `staff-of-${id}`, 'STAFF');
    await addVisit(pool, { merchantId: id, campaignId: campaign, customer: customers.c1, date: '2026-09-29' }); // 화요일
    await addVisit(pool, { merchantId: id, campaignId: campaign, customer: customers.c1, date: '2026-10-04' }); // 일요일
    await addVisit(pool, { merchantId: id, campaignId: campaign, customer: customers.c2, date: '2026-10-05' }); // 다음 월요일
  }
  const comparisonOf = async (id: string) => (await db.overview.overview({ merchantId: id })).comparison;

  const sunday = await db.overview.overview({ merchantId: 'old' });
  assert.equal(sunday.weekStartsOn, '2026-09-28');
  assert.equal(sunday.visits.today, 1);
  assert.equal(sunday.visits.thisWeek, 2); // 09-29, 10-04
  assert.equal(sunday.visits.lastWeek, 0);
  // 지난주 같은 기간(2026-09-21~09-27)에는 방문이 없다.
  assert.deepEqual(sunday.comparison, { lastWeekSameSpan: 0, delta: 2 });
  assert.equal(await comparisonOf('late'), null);
  assert.equal(await comparisonOf('fresh'), null);

  // 월요일 00:00:00 KST부터 새 주다. 지난주 시작이 2026-09-28 00:00 KST로 밀려 이번 주에 공개한 가게만 계속 숨는다.
  db.state.now = new Date('2026-10-04T15:00:00.000Z');
  const monday = await db.overview.overview({ merchantId: 'old' });
  assert.equal(monday.businessDate, '2026-10-05');
  assert.equal(monday.weekStartsOn, '2026-10-05');
  assert.equal(monday.visits.today, 1);
  assert.equal(monday.visits.thisWeek, 1); // 10-05만
  assert.equal(monday.visits.lastWeek, 2); // 09-29, 10-04
  // 월요일에는 지난주 월요일 하루(09-28)와 비교한다.
  assert.deepEqual(monday.comparison, { lastWeekSameSpan: 0, delta: 1 });
  assert.deepEqual(await comparisonOf('late'), { lastWeekSameSpan: 0, delta: 1 });
  assert.equal(await comparisonOf('fresh'), null);

  // 다음 월요일(2026-10-12 00:00 KST)에는 지난주 시작이 2026-10-05라 10-01에 공개한 가게도 비교가 보인다.
  db.state.now = new Date('2026-10-11T15:00:00.000Z');
  assert.deepEqual(await comparisonOf('fresh'), { lastWeekSameSpan: 1, delta: -1 });
});

test('the staff-own-visit rule follows the counted-visit definition: real stores skip it, demo stores keep it', { skip }, async t => {
  const db = await setup(t);
  const { pool } = db;
  await seedMerchant(pool, 'real');
  await seedMerchant(pool, 'demo', { demo: true });
  for (const id of ['real', 'demo']) {
    const campaign = await seedCampaign(pool, `camp-${id}`, id);
    await addMember(pool, id, 'dual-role', 'STAFF');
    await addVisit(pool, { merchantId: id, campaignId: campaign, customer: 'dual-role', date: '2026-10-07', slotBy: 'dual-role' });
    await addVisit(pool, { merchantId: id, campaignId: campaign, customer: customers.c1, date: '2026-10-07', slotBy: 'dual-role' });
  }
  assert.equal((await db.overview.overview({ merchantId: 'real' })).visits.today, 1);
  assert.equal((await db.overview.overview({ merchantId: 'demo' })).visits.today, 2);
});

test('the campaign card picks the live campaign, else the upcoming one, else the latest', { skip }, async t => {
  const db = await setup(t);
  const { pool } = db;
  await seedMerchant(pool, 'with-live');
  await seedCampaign(pool, 'old-ended', 'with-live', { status: 'ENDED', isPublic: false, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' });
  await seedCampaign(pool, 'upcoming-a', 'with-live', { startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', isPublic: false });
  await seedCampaign(pool, 'live-a', 'with-live', { title: '가을 방문', endsAt: '2026-12-31T00:00:00Z' });
  assert.deepEqual((await db.overview.overview({ merchantId: 'with-live' })).campaign, {
    title: '가을 방문', status: 'ACTIVE', isPublic: true, phase: 'LIVE',
    startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z',
  });

  await seedMerchant(pool, 'only-upcoming');
  await seedCampaign(pool, 'up-1', 'only-upcoming', { title: '나중', startsAt: '2026-12-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z' });
  await seedCampaign(pool, 'up-ended', 'only-upcoming', { status: 'ENDED', isPublic: false, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' });
  const upcoming = (await db.overview.overview({ merchantId: 'only-upcoming' })).campaign;
  assert.equal(upcoming?.title, '나중');
  assert.equal(upcoming?.phase, 'SCHEDULED');

  await seedMerchant(pool, 'only-past');
  await seedCampaign(pool, 'p-1', 'only-past', { title: '여름', status: 'ENDED', isPublic: false, startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-07-01T00:00:00Z' });
  await seedCampaign(pool, 'p-2', 'only-past', { title: '봄', status: 'ENDED', isPublic: false, startsAt: '2026-03-01T00:00:00Z', endsAt: '2026-04-01T00:00:00Z' });
  const latest = (await db.overview.overview({ merchantId: 'only-past' })).campaign;
  assert.equal(latest?.title, '여름');
  assert.equal(latest?.status, 'ENDED');
  assert.equal(latest?.phase, 'ENDED');
});

test('readiness steps come from the real rows: members, menu, hours, reward link and approval wait', { skip }, async t => {
  const db = await setup(t);
  const { pool } = db;
  // 새 점포: 관리자가 만든 직후 PAUSED. 메뉴·영업시간·주소와 활성 점주가 있으면 승인 대기다.
  await seedMerchant(pool, 'fresh', { status: 'PAUSED', publishedAt: null });
  await addMember(pool, 'fresh', 'owner-fresh', 'OWNER');
  await addMember(pool, 'fresh', 'staff-1', 'STAFF');
  await addMember(pool, 'fresh', 'staff-2', 'STAFF');
  await addMember(pool, 'fresh', 'staff-gone', 'STAFF', 'REVOKED');
  await addMember(pool, 'fresh', 'owner-gone', 'OWNER', 'REVOKED');
  let readiness = (await db.overview.overview({ merchantId: 'fresh' })).readiness;
  const states = () => Object.fromEntries(readiness.steps.map(step => [step.key, step.state]));
  assert.deepEqual(states(), {
    basic: 'DONE', menu: 'DONE', members: 'DONE', reward: 'NEEDS_SETUP', campaign: 'NEEDS_SETUP', visible: 'WAITING_APPROVAL',
  });
  assert.match(readiness.steps[2]!.hint, /점주 1명 · 직원 2명/); // 취소된 멤버는 세지 않는다
  assert.equal(readiness.message, '고객 앱 공개까지 3단계 남았습니다.');

  // 캠페인 초안 + 목표 {1,3,5}(연결 없음): 보상 설정 필요, 캠페인은 확인 필요.
  await seedCampaign(pool, 'draft-1', 'fresh', { status: 'DRAFT', isPublic: false });
  readiness = (await db.overview.overview({ merchantId: 'fresh' })).readiness;
  assert.equal(states().reward, 'NEEDS_SETUP');
  assert.equal(states().campaign, 'CHECK');

  // 비어 있는 영업시간·메뉴는 기본 정보·메뉴 단계를 막는다.
  await seedMerchant(pool, 'bare', { status: 'PAUSED', publishedAt: null, businessHours: '', menu: [], roadAddress: '서울' });
  readiness = (await db.overview.overview({ merchantId: 'bare' })).readiness;
  assert.equal(states().basic, 'NEEDS_SETUP');
  assert.equal(states().menu, 'NEEDS_SETUP');
  assert.equal(states().members, 'CHECK');
  assert.equal(states().visible, 'NEEDS_SETUP');

  // 활성 캠페인에 수집품이 연결되면 방문 보상 단계가 완료된다. 연결이 없으면 완료가 아니다.
  await seedMerchant(pool, 'rewarded');
  await addMember(pool, 'rewarded', 'owner-r', 'OWNER');
  await seedCampaign(pool, 'rewarded-camp', 'rewarded');
  assert.equal((await db.overview.overview({ merchantId: 'rewarded' })).readiness.steps[3]!.state, 'NEEDS_SETUP');
  await linkCollectible(pool, 'rewarded-camp', 'rewarded');
  readiness = (await db.overview.overview({ merchantId: 'rewarded' })).readiness;
  assert.ok(readiness.steps.every(step => step.state === 'DONE'));
  assert.equal(readiness.remaining, 0);
  assert.equal(readiness.message, '고객 앱에 보이고 있어요.');

  // 시작 전 캠페인은 "공개 예정"이다.
  await seedMerchant(pool, 'soon');
  await addMember(pool, 'soon', 'owner-s', 'OWNER');
  await seedCampaign(pool, 'soon-camp', 'soon', { startsAt: '2026-10-20T00:00:00Z', linked: true });
  readiness = (await db.overview.overview({ merchantId: 'soon' })).readiness;
  assert.equal(states().campaign, 'SCHEDULED');
  assert.equal(states().visible, 'NEEDS_SETUP');
});

type ParityCase = {
  name: string; expectVisible: boolean; merchant?: MerchantSeed; guestTrial?: boolean;
  campaigns: (CampaignSeed & { id: string })[];
};

const liveWindow = { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' };
const parityCases: ParityCase[] = [
  { name: 'fully visible', expectVisible: true, campaigns: [{ id: 'c', ...liveWindow }] },
  { name: 'paused store', expectVisible: false, merchant: { status: 'PAUSED' }, campaigns: [{ id: 'c', ...liveWindow }] },
  { name: 'campaign not started', expectVisible: false, campaigns: [{ id: 'c', startsAt: '2026-10-08T00:00:00Z', endsAt: '2026-12-31T00:00:00Z' }] },
  { name: 'campaign ended by date', expectVisible: false, campaigns: [{ id: 'c', startsAt: '2026-08-01T00:00:00Z', endsAt: '2026-10-06T00:00:00Z' }] },
  { name: 'campaign status ENDED', expectVisible: false, campaigns: [{ id: 'c', status: 'ENDED', isPublic: false, ...liveWindow }] },
  { name: 'goals are not 1/3/5', expectVisible: false, campaigns: [{ id: 'c', goals: [1, 3], ...liveWindow }] },
  { name: 'only the 5-visit goal', expectVisible: false, campaigns: [{ id: 'c', goals: [5], ...liveWindow }] },
  { name: 'campaign not public', expectVisible: false, campaigns: [{ id: 'c', isPublic: false, ...liveWindow }] },
  { name: 'campaign draft', expectVisible: false, campaigns: [{ id: 'c', status: 'DRAFT', isPublic: false, ...liveWindow }] },
  { name: 'campaign paused', expectVisible: false, campaigns: [{ id: 'c', status: 'PAUSED', isPublic: false, ...liveWindow }] },
  { name: 'no campaign at all', expectVisible: false, campaigns: [] },
  { name: 'guest trial store', expectVisible: false, guestTrial: true, campaigns: [{ id: 'c', ...liveWindow }] },
  { name: 'starts exactly now', expectVisible: true, campaigns: [{ id: 'c', startsAt: WEDNESDAY_NOON, endsAt: '2026-12-31T00:00:00Z' }] },
  { name: 'ends exactly now', expectVisible: false, campaigns: [{ id: 'c', startsAt: '2026-09-01T00:00:00Z', endsAt: WEDNESDAY_NOON }] },
  {
    name: 'old ended campaign plus a visible one', expectVisible: true,
    campaigns: [
      { id: 'old', status: 'ENDED', isPublic: false, startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z' },
      { id: 'c', ...liveWindow },
    ],
  },
  {
    name: 'visible without a collectible link', expectVisible: true,
    campaigns: [{ id: 'c', linked: false, ...liveWindow }],
  },
  {
    name: 'paused store with a bad-goals draft', expectVisible: false, merchant: { status: 'PAUSED' },
    campaigns: [{ id: 'c', status: 'DRAFT', isPublic: false, goals: [1], ...liveWindow }],
  },
];

test('the checklist "visible" step is DONE exactly when the store is on the public customer list', { skip }, async t => {
  const db = await setup(t);
  const { pool } = db;
  for (const [index, scenario] of parityCases.entries()) {
    const merchantId = `parity-${index}`;
    await seedMerchant(pool, merchantId, scenario.merchant);
    for (const campaign of scenario.campaigns) {
      await seedCampaign(pool, `${merchantId}-${campaign.id}`, merchantId, campaign);
    }
    if (scenario.guestTrial) {
      await pool.query(`INSERT INTO showcase_guest_trials (account_id, merchant_id, expires_at)
        VALUES ($1, $2, now() + interval '1 day')`, [`guest-${index}`, merchantId]);
    }
  }
  const listed = new Set((await db.catalog.listPublicMerchants()).map(merchant => merchant.id));
  for (const [index, scenario] of parityCases.entries()) {
    const merchantId = `parity-${index}`;
    const { readiness } = await db.overview.overview({ merchantId });
    const visibleStep = readiness.steps.find(step => step.key === 'visible')!;
    assert.equal(listed.has(merchantId), scenario.expectVisible, `catalog: ${scenario.name}`);
    assert.equal(visibleStep.state === 'DONE', listed.has(merchantId), `parity: ${scenario.name} (${visibleStep.state})`);
    assert.equal(readiness.message === '고객 앱에 보이고 있어요.', listed.has(merchantId), `message: ${scenario.name}`);
  }
});

test('an unknown store is reported as not found', { skip }, async t => {
  const db = await setup(t);
  await assert.rejects(db.overview.overview({ merchantId: 'no-such-shop' }),
    error => error instanceof MerchantOverviewError && error.code === 'MERCHANT_NOT_FOUND');
});

test('repeated overview reads change no rows and leave no connection checked out', { skip }, async t => {
  const db = await setup(t);
  await seedMerchant(db.pool, 'readonly');
  const before = await db.pool.query('SELECT (SELECT count(*) FROM merchants) AS m, (SELECT count(*) FROM visit_events) AS v');
  for (let index = 0; index < 12; index += 1) await db.overview.overview({ merchantId: 'readonly' });
  assert.deepEqual((await db.pool.query('SELECT (SELECT count(*) FROM merchants) AS m, (SELECT count(*) FROM visit_events) AS v')).rows,
    before.rows);
  assert.equal(db.pool.idleCount, db.pool.totalCount);
  assert.equal(db.pool.waitingCount, 0);
});
