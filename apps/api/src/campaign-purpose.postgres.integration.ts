// Issue #412 (D-092): 점주 목적형 캠페인(migration 0068)과 시간대 조건. 방문 인정은 시간대와 무관하고 혜택 상태만 시간대를 따른다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import type { TimeWindow } from './campaign-purpose-rules.js';
import { PostgresAdminService } from './postgres/admin.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresRealWorldService } from './postgres/real-world.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';
const hmacSecret = 'campaign-purpose-test-hmac-secret-32-bytes';
const referenceSecret = 'test-reference-hmac-secret-32-bytes';

// 한국 시간으로 적은 순간. 2026-10-05는 월요일(10-09 금, 10-10 토)이다.
const kst = (value: string) => new Date(`${value}+09:00`);
const weekdayAfternoon: TimeWindow[] = [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }];

async function setup(t: TestContext) {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  return pool;
}

async function makeAdmin(pool: Pool) {
  const accountId = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [`purpose-${randomUUID()}`, accountId]);
  await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [accountId]);
  return accountId;
}

async function makeMerchant(pool: Pool, menu: { name: string; priceWon: number }[] = []) {
  const id = randomUUID();
  await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status, is_demo, menu_items)
    VALUES ($1, '목적 점포', '', '서울', 0, 'PAUSED', false, $2::jsonb)`, [id, JSON.stringify(menu)]);
  return id;
}

function draftInput(merchantId: string, extra: Record<string, unknown> = {}) {
  return { merchantId, title: '목적 캠페인', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z',
    enrollmentCapacity: 50, rewardGoals: [
      { targetVisitCount: 1 as const, displayName: '첫 방문' },
      { targetVisitCount: 3 as const, displayName: '세 번째 방문' },
      { targetVisitCount: 5 as const, displayName: '다섯 번째 방문' },
    ], ...extra };
}

// 방문 시험용 점포·점원·캠페인. 목적은 초안일 때 넣고 그 뒤 공개한다(공개된 캠페인에는 목적 행을 새로 만들 수 없다).
async function makeWorld(pool: Pool, purposeColumns?: { purpose: string; time_windows?: TimeWindow[]; featured_menu_name?: string }) {
  const world = { merchantId: `cp-m-${randomUUID()}`, campaignId: `cp-c-${randomUUID()}`, staffId: `cp-staff-${randomUUID()}` };
  await pool.query(`INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo, published_at)
    VALUES ($1, '방문 시험 점포', '', '서울 노원구', 0, 'ACTIVE', true, now())`, [world.merchantId]);
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
    [world.merchantId, world.staffId]);
  await pool.query(`INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ($1, $2, '시간대 캠페인', '2026-09-01T00:00:00Z', '2026-12-31T00:00:00Z', 'DRAFT', false, 100)`,
    [world.campaignId, world.merchantId]);
  await pool.query(`INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
    VALUES ($1, 1, '첫 방문'), ($1, 3, '세 번째'), ($1, 5, '다섯 번째')`, [world.campaignId]);
  if (purposeColumns) {
    await pool.query(`INSERT INTO campaign_purposes (campaign_id, purpose, time_windows, featured_menu_name)
      VALUES ($1, $2, $3::jsonb, $4)`, [world.campaignId, purposeColumns.purpose,
      purposeColumns.time_windows ? JSON.stringify(purposeColumns.time_windows) : null, purposeColumns.featured_menu_name ?? null]);
  }
  await pool.query(`UPDATE campaigns SET status = 'ACTIVE', is_public = true WHERE id = $1`, [world.campaignId]);
  return world;
}

function claimService(pool: Pool) {
  const clock = { now: kst('2026-10-05T12:00:00') };
  const service = new PostgresClaimSlotService(pool, { now: () => clock.now, referenceHmacSecret: referenceSecret });
  let counter = 0;
  // 점원이 issueAt에 코드를 만들고 고객이 redeemAt에 확정한다.
  async function visit(world: { merchantId: string; staffId: string }, issueAt: Date, redeemAt: Date, customer = `cp-customer-${randomUUID()}`) {
    clock.now = issueAt;
    const issued = await service.issue({ merchantId: world.merchantId, customerAccountId: customer,
      merchantReference: `ref-${++counter}`, createdByAccountId: world.staffId });
    clock.now = redeemAt;
    const redeemed = await service.redeem({ accountId: customer, token: issued.token });
    return { customer, issued, redeemed };
  }
  return { service, clock, visit };
}

async function expectCheckViolation(promise: Promise<unknown>, constraint?: string | RegExp) {
  await assert.rejects(promise, (error: { code?: string; constraint?: string; message?: string }) => {
    if (error.code !== '23514') return false;
    return constraint === undefined || (typeof constraint === 'string' ? error.constraint === constraint : constraint.test(error.message ?? ''));
  });
}

test('a draft and its purpose are created in one transaction with both audit rows, and an invalid purpose writes nothing', { skip }, async (t) => {
  const pool = await setup(t);
  const admin = new PostgresAdminService(pool, hmacSecret);
  const accountId = await makeAdmin(pool);
  const merchantId = await makeMerchant(pool, [{ name: '김밥', priceWon: 4500 }, { name: '라면', priceWon: 5000 }]);
  const noMenuMerchantId = await makeMerchant(pool);

  const purpose = { purpose: 'OFF_PEAK', featuredMenuName: '김밥', timeWindows: [{ days: [5, 1, 2, 3, 4], start: '14:00', end: '17:00' }] };
  const created = await admin.createCampaignDraft(accountId, draftInput(merchantId, { purpose }));
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.public, false);
  assert.deepEqual(created.purpose, { kind: 'OFF_PEAK', featuredMenuName: '김밥',
    timeWindows: [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }] });
  assert.deepEqual((await admin.listCampaignDrafts(accountId)).find(draft => draft.id === created.id), created);
  const stored = await pool.query(`SELECT purpose, featured_menu_name, revisit_min_days, revisit_window_days, next_step_text,
      time_windows, intro_text FROM campaign_purposes WHERE campaign_id = $1`, [created.id]);
  assert.deepEqual(stored.rows, [{ purpose: 'OFF_PEAK', featured_menu_name: '김밥', revisit_min_days: 1, revisit_window_days: 14,
    next_step_text: null, time_windows: [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }], intro_text: null }]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaign_goals WHERE campaign_id = $1`, [created.id])).rows[0]!.n, 3);
  const audit = await pool.query<{ action: string; after_state: { campaignId?: string; purpose?: { kind: string } } }>(
    `SELECT action, after_state FROM platform_admin_audit WHERE merchant_id = $1 ORDER BY action`, [merchantId]);
  assert.deepEqual(audit.rows.map(row => row.action), ['CAMPAIGN_DRAFT_CREATED', 'CAMPAIGN_PURPOSE_SET']);
  assert.equal(audit.rows[1]!.after_state.campaignId, created.id);
  assert.equal(audit.rows[1]!.after_state.purpose?.kind, 'OFF_PEAK');

  // 목적 없는 초안은 옛 방식 그대로: 목적 행도, 목적 감사도, 응답의 purpose도 없다.
  const legacy = await admin.createCampaignDraft(accountId, draftInput(noMenuMerchantId));
  assert.equal('purpose' in legacy, false);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaign_purposes WHERE campaign_id = $1`, [legacy.id])).rows[0]!.n, 0);
  assert.deepEqual((await pool.query(`SELECT action FROM platform_admin_audit WHERE merchant_id = $1`, [noMenuMerchantId])).rows,
    [{ action: 'CAMPAIGN_DRAFT_CREATED' }]);

  // 메뉴 정보가 없는 점포는 대표 메뉴를 이름 형식만 검사한다. 재방문·새 손님 목적도 같은 한 트랜잭션이다.
  const revisit = await admin.createCampaignDraft(accountId, draftInput(noMenuMerchantId, {
    title: '재방문', purpose: { purpose: 'REVISIT', revisitMinDays: 3, nextStepText: '다음에는 코인이 완성돼요', featuredMenuName: '아무 메뉴' } }));
  assert.deepEqual(revisit.purpose, { kind: 'REVISIT', featuredMenuName: '아무 메뉴', revisitMinDays: 3, revisitWindowDays: 14,
    nextStepText: '다음에는 코인이 완성돼요' });
  const newcomers = await admin.createCampaignDraft(accountId, draftInput(noMenuMerchantId, { title: '새 손님', purpose: { purpose: 'NEW_CUSTOMERS' } }));
  assert.deepEqual(newcomers.purpose, { kind: 'NEW_CUSTOMERS' });

  // 잘못된 목적은 캠페인·목표·목적·감사 어느 것도 남기지 않는다. 권한 검사가 먼저다.
  const before = async () => (await pool.query(`SELECT
      (SELECT count(*)::int FROM campaigns WHERE merchant_id = $1) AS campaigns,
      (SELECT count(*)::int FROM campaign_goals WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)) AS goals,
      (SELECT count(*)::int FROM campaign_purposes WHERE campaign_id IN (SELECT id FROM campaigns WHERE merchant_id = $1)) AS purposes,
      (SELECT count(*)::int FROM platform_admin_audit WHERE merchant_id = $1) AS audits`, [merchantId])).rows[0];
  const snapshot = await before();
  for (const [bad, code] of [
    [{ purpose: 'UNKNOWN' }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'OFF_PEAK' }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'OFF_PEAK', timeWindows: [{ days: [1], start: '17:00', end: '14:00' }] }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'NEW_CUSTOMERS', timeWindows: [{ days: [1], start: '14:00', end: '17:00' }] }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'REVISIT', revisitMinDays: 20, revisitWindowDays: 10 }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'NEW_CUSTOMERS', featuredMenuName: '010-1234-5678' }, /ADMIN_PURPOSE_INVALID/],
    [{ purpose: 'NEW_CUSTOMERS', featuredMenuName: '우동' }, /ADMIN_PURPOSE_MENU_UNKNOWN/],
    [null, /ADMIN_PURPOSE_INVALID/],
    ['OFF_PEAK', /ADMIN_PURPOSE_INVALID/],
  ] as const) {
    await assert.rejects(admin.createCampaignDraft(accountId, draftInput(merchantId, { purpose: bad })), code, JSON.stringify(bad));
  }
  await assert.rejects(admin.createCampaignDraft('not-an-admin', draftInput(merchantId, { purpose: { purpose: 'UNKNOWN' } })), /ADMIN_FORBIDDEN/);
  assert.deepEqual(await before(), snapshot);
});

test('a failure while saving the purpose rolls the campaign, its goals and the audit back', { skip }, async (t) => {
  const pool = await setup(t);
  const admin = new PostgresAdminService(pool, hmacSecret);
  const accountId = await makeAdmin(pool);
  const merchantId = await makeMerchant(pool);
  await pool.query(`CREATE OR REPLACE FUNCTION campaign_purpose_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'forced purpose failure'; END $$`);
  await pool.query(`CREATE TRIGGER campaign_purpose_fail_test BEFORE INSERT ON campaign_purposes
    FOR EACH ROW EXECUTE FUNCTION campaign_purpose_fail_test()`);
  try {
    await assert.rejects(admin.createCampaignDraft(accountId, draftInput(merchantId, { title: '롤백 목적 초안',
      purpose: { purpose: 'NEW_CUSTOMERS' } })), /forced purpose failure/);
  } finally {
    await pool.query('DROP TRIGGER campaign_purpose_fail_test ON campaign_purposes');
    await pool.query('DROP FUNCTION campaign_purpose_fail_test()');
  }
  // 캠페인·목표·감사 행은 목적보다 먼저 들어갔지만 모두 되돌려졌다.
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaigns WHERE merchant_id = $1`, [merchantId])).rows[0]!.n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM platform_admin_audit WHERE merchant_id = $1`, [merchantId])).rows[0]!.n, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaign_goals WHERE campaign_id NOT IN (SELECT id FROM campaigns)`)).rows[0]!.n, 0);
  // 같은 입력은 트리거를 치우면 그대로 만들어진다.
  const ok = await admin.createCampaignDraft(accountId, draftInput(merchantId, { title: '롤백 목적 초안', purpose: { purpose: 'NEW_CUSTOMERS' } }));
  assert.deepEqual(ok.purpose, { kind: 'NEW_CUSTOMERS' });
});

test('the purpose table rejects every malformed row on its own, whatever the API does', { skip }, async (t) => {
  const pool = await setup(t);
  const merchantId = await makeMerchant(pool);
  let n = 0;
  const draft = async () => {
    const id = `cp-check-${++n}-${randomUUID()}`;
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
      VALUES ($1, $2, '검사', now(), now() + interval '1 day', 'DRAFT', false, 1)`, [id, merchantId]);
    return id;
  };
  const insert = async (columns: string, values: unknown[]) => {
    const id = await draft();
    const marks = values.map((_, index) => `$${index + 2}`).join(', ');
    return pool.query(`INSERT INTO campaign_purposes(campaign_id, ${columns}) VALUES ($1, ${marks})`, [id, ...values]);
  };
  await insert('purpose', ['NEW_CUSTOMERS']);
  await insert('purpose, time_windows', ['OFF_PEAK', JSON.stringify(weekdayAfternoon)]);
  await insert('purpose, time_windows', ['OFF_PEAK', JSON.stringify([{ days: [7], start: '21:00', end: '24:00' }])]);
  await insert('purpose, revisit_min_days, revisit_window_days, next_step_text', ['REVISIT', 30, 31, '다음에']);
  await expectCheckViolation(insert('purpose', ['ALL']));
  await expectCheckViolation(insert('purpose', ['OFF_PEAK']), 'campaign_purposes_windows_iff_off_peak');
  await expectCheckViolation(insert('purpose, time_windows', ['NEW_CUSTOMERS', JSON.stringify(weekdayAfternoon)]), 'campaign_purposes_windows_iff_off_peak');
  await expectCheckViolation(insert('purpose, next_step_text', ['OFF_PEAK', '다음에']));
  await expectCheckViolation(insert('purpose, next_step_text', ['NEW_CUSTOMERS', '다음에']), 'campaign_purposes_next_step_revisit_only');
  await expectCheckViolation(insert('purpose, revisit_min_days, revisit_window_days', ['REVISIT', 5, 5]), 'campaign_purposes_revisit_days_order');
  await expectCheckViolation(insert('purpose, revisit_min_days', ['REVISIT', 14]), 'campaign_purposes_revisit_days_order');
  await expectCheckViolation(insert('purpose, revisit_min_days', ['REVISIT', 0]));
  await expectCheckViolation(insert('purpose, revisit_window_days', ['REVISIT', 61]));
  await expectCheckViolation(insert('purpose, featured_menu_name', ['NEW_CUSTOMERS', '']));
  await expectCheckViolation(insert('purpose, featured_menu_name', ['NEW_CUSTOMERS', '가'.repeat(41)]));
  await expectCheckViolation(insert('purpose, next_step_text', ['REVISIT', '가'.repeat(81)]));
  // 시간대 jsonb: 개수, 요일, 시각 형식, 끝이 시작보다 늦어야 함, 모르는 키.
  for (const bad of [
    [], [weekdayAfternoon[0], weekdayAfternoon[0], weekdayAfternoon[0], weekdayAfternoon[0]], {}, 'text', [1],
    [{ days: [], start: '14:00', end: '17:00' }], [{ days: [0], start: '14:00', end: '17:00' }], [{ days: [8], start: '14:00', end: '17:00' }],
    [{ days: [1, 1], start: '14:00', end: '17:00' }], [{ days: ['1'], start: '14:00', end: '17:00' }], [{ days: [1.5], start: '14:00', end: '17:00' }],
    [{ days: [1], start: '9:00', end: '17:00' }], [{ days: [1], start: '14:00', end: '24:01' }], [{ days: [1], start: '24:00', end: '24:00' }],
    [{ days: [1], start: '22:00', end: '02:00' }], [{ days: [1], start: '14:00', end: '14:00' }],
    [{ days: [1], start: '14:00' }], [{ days: [1], start: '14:00', end: '17:00', note: 'x' }],
  ]) {
    await expectCheckViolation(insert('purpose, time_windows', ['OFF_PEAK', JSON.stringify(bad)]), 'campaign_purposes_time_windows_check');
  }
  // 소개 글·확인 번호·확인 시각은 함께 있거나 함께 없다. 확인 번호는 참조 번호 형식이어야 한다.
  await insert('purpose, intro_text, intro_verified_ref, intro_verified_at', ['NEW_CUSTOMERS', '동네 칼국수집이에요', 'OWN-2610-01', new Date()]);
  await expectCheckViolation(insert('purpose, intro_text', ['NEW_CUSTOMERS', '소개만']), 'campaign_purposes_intro_all_or_none');
  await expectCheckViolation(insert('purpose, intro_verified_ref', ['NEW_CUSTOMERS', 'OWN-2610-01']), 'campaign_purposes_intro_all_or_none');
  await expectCheckViolation(insert('purpose, intro_text, intro_verified_ref, intro_verified_at', ['NEW_CUSTOMERS', '소개', '010-1234-5678', new Date()]));
  await expectCheckViolation(insert('purpose, intro_text, intro_verified_ref, intro_verified_at', ['NEW_CUSTOMERS', '가'.repeat(201), 'OWN-2610-01', new Date()]));
});

test('after the campaign leaves draft only the verified intro may change, and a purpose cannot be added or removed', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon, featured_menu_name: '라떼' });
  const legacy = await makeWorld(pool);
  const terms = async (statement: string, ...values: unknown[]) => pool.query(statement, [world.campaignId, ...values]);

  // 공개(ACTIVE)된 뒤에는 조건 어느 것도 못 바꾼다.
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET purpose = 'REVISIT', time_windows = NULL WHERE campaign_id = $1`), /immutable/);
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET time_windows = $2::jsonb WHERE campaign_id = $1`,
    JSON.stringify([{ days: [6], start: '10:00', end: '11:00' }])), /immutable/);
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET featured_menu_name = '아메리카노' WHERE campaign_id = $1`), /immutable/);
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET revisit_window_days = 30 WHERE campaign_id = $1`), /immutable/);
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET campaign_id = $2 WHERE campaign_id = $1`, legacy.campaignId), /moved/);
  await expectCheckViolation(terms(`DELETE FROM campaign_purposes WHERE campaign_id = $1`), /immutable/);
  await expectCheckViolation(pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose) VALUES ($1, 'NEW_CUSTOMERS')`, [legacy.campaignId]), /draft/);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaign_purposes WHERE campaign_id = $1`, [legacy.campaignId])).rows[0]!.n, 0);

  // intro_* 세 칸은 게시 뒤에도 바꿀 수 있다(점주 확인이 늦게 끝나는 경우). 하나만 바꾸면 all-or-none이 막는다.
  await terms(`UPDATE campaign_purposes SET intro_text = '동네 카페예요', intro_verified_ref = 'OWN-2610-02', intro_verified_at = now() WHERE campaign_id = $1`);
  await terms(`UPDATE campaign_purposes SET intro_text = '수정한 소개', intro_verified_ref = 'OWN-2610-03', intro_verified_at = now() WHERE campaign_id = $1`);
  await expectCheckViolation(terms(`UPDATE campaign_purposes SET intro_text = '확인 없이' , intro_verified_ref = NULL WHERE campaign_id = $1`),
    'campaign_purposes_intro_all_or_none');
  const row = (await terms(`SELECT intro_text, intro_verified_ref, purpose, featured_menu_name FROM campaign_purposes WHERE campaign_id = $1`)).rows[0];
  assert.deepEqual(row, { intro_text: '수정한 소개', intro_verified_ref: 'OWN-2610-03', purpose: 'OFF_PEAK', featured_menu_name: '라떼' });

  // 중지·종료에서도 같다.
  for (const status of ['PAUSED', 'ENDED']) {
    await terms(`UPDATE campaigns SET status = '${status}', is_public = false WHERE id = $1`);
    await terms(`UPDATE campaign_purposes SET intro_text = '${status} 소개', intro_verified_ref = 'OWN-2610-04', intro_verified_at = now() WHERE campaign_id = $1`);
    await expectCheckViolation(terms(`UPDATE campaign_purposes SET featured_menu_name = '라떼2' WHERE campaign_id = $1`), /immutable/);
  }

  // 초안이면 자유롭게 고치고 지울 수 있고, 초안 캠페인을 지우면 목적도 함께 지워진다.
  const draftId = `cp-draft-${randomUUID()}`;
  await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ($1, $2, '초안', now(), now() + interval '1 day', 'DRAFT', false, 1)`, [draftId, world.merchantId]);
  await pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose) VALUES ($1, 'NEW_CUSTOMERS')`, [draftId]);
  await pool.query(`UPDATE campaign_purposes SET purpose = 'REVISIT', featured_menu_name = '수정' WHERE campaign_id = $1`, [draftId]);
  await pool.query(`DELETE FROM campaign_purposes WHERE campaign_id = $1`, [draftId]);
  await pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose) VALUES ($1, 'NEW_CUSTOMERS')`, [draftId]);
  await pool.query(`DELETE FROM campaigns WHERE id = $1`, [draftId]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM campaign_purposes WHERE campaign_id = $1`, [draftId])).rows[0]!.n, 0);
});

test('a purpose row cannot be moved onto another campaign, so a draft row never lands on an active campaign', { skip }, async (t) => {
  const pool = await setup(t);
  const active = await makeWorld(pool);
  const draftId = `cp-move-${randomUUID()}`;
  const otherDraftId = `cp-move-${randomUUID()}`;
  for (const id of [draftId, otherDraftId]) {
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
      VALUES ($1, $2, '이동 초안', now(), now() + interval '1 day', 'DRAFT', false, 1)`, [id, active.merchantId]);
  }
  await pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose, time_windows) VALUES ($1, 'OFF_PEAK', $2::jsonb)`,
    [draftId, JSON.stringify(weekdayAfternoon)]);
  // 초안 행을 이미 공개된 캠페인으로 옮기는 길(공개 뒤 조건을 사후에 심는 길)도, 다른 초안으로 옮기는 길도 막힌다.
  await expectCheckViolation(pool.query(`UPDATE campaign_purposes SET campaign_id = $2 WHERE campaign_id = $1`, [draftId, active.campaignId]), /moved/);
  await expectCheckViolation(pool.query(`UPDATE campaign_purposes SET campaign_id = $2 WHERE campaign_id = $1`, [draftId, otherDraftId]), /moved/);
  assert.deepEqual((await pool.query(`SELECT campaign_id FROM campaign_purposes WHERE campaign_id IN ($1, $2, $3)`,
    [draftId, otherDraftId, active.campaignId])).rows, [{ campaign_id: draftId }]);
  // 같은 캠페인에 그대로 있는 초안 행은 계속 고칠 수 있다.
  await pool.query(`UPDATE campaign_purposes SET featured_menu_name = '수정', campaign_id = campaign_id WHERE campaign_id = $1`, [draftId]);
});

test('publishing a purpose draft through the admin service freezes its conditions and the campaign list still shows the purpose', { skip }, async (t) => {
  const pool = await setup(t);
  const admin = new PostgresAdminService(pool, hmacSecret);
  const accountId = await makeAdmin(pool);
  const merchantId = await makeMerchant(pool);
  await pool.query(`UPDATE merchants SET status = 'ACTIVE' WHERE id = $1`, [merchantId]);
  const draft = await admin.createCampaignDraft(accountId, draftInput(merchantId, {
    purpose: { purpose: 'REVISIT', revisitMinDays: 2, revisitWindowDays: 10 } }));
  // 초안일 때는 SQL로도 고칠 수 있다.
  await pool.query(`UPDATE campaign_purposes SET revisit_window_days = 12 WHERE campaign_id = $1`, [draft.id]);
  await assert.rejects(admin.publishCampaign(accountId, draft.id), /ADMIN_CAMPAIGN_NOT_PUBLISHABLE/);
  await pool.query(`INSERT INTO campaign_benefits(id, campaign_id, merchant_id, title, detail, valid_days,
    unit_extra_cost_won, max_uses, status, consent_document_ref, consent_checklist_version)
    VALUES ($1,$2,$3,'방문 혜택','',7,100,10,'ACTIVE','OPTIN-1','owner-offer-consent-v1')`,
  [randomUUID(), draft.id, merchantId]);
  const published = await admin.publishCampaign(accountId, draft.id);
  assert.equal(published.campaign.status, 'ACTIVE');
  assert.deepEqual(published.campaign.purpose, { kind: 'REVISIT', revisitMinDays: 2, revisitWindowDays: 12 });
  await expectCheckViolation(pool.query(`UPDATE campaign_purposes SET revisit_window_days = 30 WHERE campaign_id = $1`, [draft.id]), /immutable/);
  assert.deepEqual((await admin.listCampaigns(accountId)).find(item => item.id === draft.id)?.purpose,
    { kind: 'REVISIT', revisitMinDays: 2, revisitWindowDays: 12 });
  // 중지하고 다시 공개해도 조건은 그대로다.
  await admin.pauseCampaign(accountId, draft.id);
  await admin.publishCampaign(accountId, draft.id);
  assert.equal((await pool.query(`SELECT revisit_window_days FROM campaign_purposes WHERE campaign_id = $1`, [draft.id])).rows[0]!.revisit_window_days, 12);
});

test('a publish and a purpose edit racing on the same draft never leave an edited purpose behind a published campaign', { skip }, async (t) => {
  const pool = await setup(t);
  const merchantId = await makeMerchant(pool);
  const id = `cp-race-${randomUUID()}`;
  await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ($1, $2, '경합', now(), now() + interval '1 day', 'DRAFT', false, 1)`, [id, merchantId]);
  await pool.query(`INSERT INTO campaign_purposes(campaign_id, purpose, featured_menu_name) VALUES ($1, 'NEW_CUSTOMERS', '처음')`, [id]);
  const publisher = await pool.connect();
  try {
    await publisher.query('BEGIN');
    await publisher.query(`UPDATE campaigns SET status = 'ACTIVE', is_public = true WHERE id = $1`, [id]);
    // 공개가 아직 커밋되지 않은 동안 시작한 수정은 캠페인 행 잠금에서 기다렸다가 커밋 뒤 ACTIVE를 보고 거절된다.
    const edit = pool.query(`UPDATE campaign_purposes SET featured_menu_name = '몰래 바꿈' WHERE campaign_id = $1`, [id]);
    edit.catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 300));
    await publisher.query('COMMIT');
    await expectCheckViolation(edit, /immutable/);
  } finally {
    publisher.release();
  }
  assert.equal((await pool.query(`SELECT featured_menu_name FROM campaign_purposes WHERE campaign_id = $1`, [id])).rows[0]!.featured_menu_name, '처음');
});

test('a campaign without a purpose row behaves as before: same payload shape, same counts, no window or benefit', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool);
  const { service, visit } = claimService(pool);
  const { customer, issued, redeemed } = await visit(world, kst('2026-10-05T16:50:00'), kst('2026-10-05T16:55:00'));

  assert.deepEqual(Object.keys(issued).sort(), ['claimSlotId', 'expiresAt', 'token', 'tokenVersion', 'windowStatus']);
  assert.equal(issued.windowStatus, 'NONE');
  const { benefit, ...rest } = redeemed;
  assert.deepEqual(benefit, { state: 'NONE' });
  assert.deepEqual(Object.keys(rest).sort(), ['claimSlotId', 'grantedRewards', 'merchantId', 'merchantName', 'replayed', 'status', 'campaignTitle', 'visit'].sort());
  assert.equal(redeemed.replayed, false);
  assert.equal(redeemed.visit.progressCounted, true);
  assert.equal(redeemed.visit.progressVisitCount, 1);
  assert.deepEqual(redeemed.grantedRewards.map(reward => reward.targetVisitCount), [1]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM visit_events WHERE customer_account_id = $1 AND status = 'VALID' AND progress_counted`, [customer])).rows[0]!.n, 1);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM reward_entitlements WHERE customer_account_id = $1 AND status = 'GRANTED'`, [customer])).rows[0]!.n, 1);

  // 같은 코드를 다시 확정하면 같은 결과(재생)이고 혜택 상태도 같다.
  const replay = await service.redeem({ accountId: customer, token: issued.token });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.benefit, { state: 'NONE' });
  assert.equal(replay.visit.visitEventId, redeemed.visit.visitEventId);

  // 재발급도 시간대 조건이 없으면 NONE이다.
  const second = await visit(world, kst('2026-10-06T10:00:00'), kst('2026-10-06T10:01:00'));
  assert.equal(second.issued.windowStatus, 'NONE');

  // 시간대 조건이 없는 목적(새 손님·재방문)도 시간대 상태는 NONE이다.
  for (const purpose of ['NEW_CUSTOMERS', 'REVISIT']) {
    const other = await makeWorld(pool, { purpose });
    const result = await visit(other, kst('2026-10-05T03:00:00'), kst('2026-10-05T03:01:00'));
    assert.equal(result.issued.windowStatus, 'NONE');
    assert.deepEqual(result.redeemed.benefit, { state: 'NONE' });
    assert.equal(result.redeemed.visit.progressCounted, true);
  }
});

test('a slot created inside a window is eligible even when scanned after the window ended', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { service, visit } = claimService(pool);

  // 월요일 16:50에 만든 코드를 17:05(창이 끝난 뒤, 코드 유효 15분의 끝 직전)에 확정한다.
  const late = await visit(world, kst('2026-10-05T16:50:00'), kst('2026-10-05T17:04:59'));
  assert.equal(late.issued.windowStatus, 'IN_WINDOW');
  assert.deepEqual(late.redeemed.benefit, { state: 'ELIGIBLE' });
  assert.equal(late.redeemed.visit.progressCounted, true);

  // 다시 확정하면(재생) 같은 상태이고, 확정 시각이 아니라 코드를 만든 시각이 기준이다.
  const replay = await service.redeem({ accountId: late.customer, token: late.issued.token });
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.benefit, { state: 'ELIGIBLE' });
});

test('window edges: start is inclusive, end is exclusive, and the slot creation time decides, not the scan time', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { visit } = claimService(pool);
  const cases: [string, string, string, string][] = [
    // [발급(점원 확정), 스캔(고객), 코드 상태, 혜택 상태]
    ['2026-10-05T13:59:59.999', '2026-10-05T14:05:00', 'OUTSIDE_WINDOW', 'OUTSIDE_WINDOW'], // 창이 열린 뒤 스캔해도 발급이 밖이면 밖
    ['2026-10-05T14:00:00.000', '2026-10-05T14:01:00', 'IN_WINDOW', 'ELIGIBLE'],             // 시작 시각 포함
    ['2026-10-05T16:59:59.999', '2026-10-05T17:10:00', 'IN_WINDOW', 'ELIGIBLE'],             // 끝 직전
    ['2026-10-05T17:00:00.000', '2026-10-05T17:01:00', 'OUTSIDE_WINDOW', 'OUTSIDE_WINDOW'],  // 끝 시각 제외
    ['2026-10-09T15:30:00.000', '2026-10-09T15:31:00', 'IN_WINDOW', 'ELIGIBLE'],             // 금요일
    ['2026-10-10T15:30:00.000', '2026-10-10T15:31:00', 'OUTSIDE_WINDOW', 'OUTSIDE_WINDOW'],  // 토요일
    ['2026-10-11T15:30:00.000', '2026-10-11T15:31:00', 'OUTSIDE_WINDOW', 'OUTSIDE_WINDOW'],  // 일요일
    ['2026-10-06T00:30:00.000', '2026-10-06T00:31:00', 'OUTSIDE_WINDOW', 'OUTSIDE_WINDOW'],  // 화요일 새벽
  ];
  for (const [issuedAt, scannedAt, windowStatus, benefit] of cases) {
    const result = await visit(world, kst(issuedAt), kst(scannedAt));
    assert.equal(result.issued.windowStatus, windowStatus, issuedAt);
    assert.equal(result.redeemed.benefit?.state, benefit, issuedAt);
    // D1: 시간대와 무관하게 방문은 인정되고 코인(진행)이 센다.
    assert.equal(result.redeemed.visit.progressCounted, true, issuedAt);
    assert.equal(result.redeemed.visit.progressVisitCount, 1, issuedAt);
  }
});

test('an out-of-window visit stays valid: counted, rewarded and identical to an in-window visit except for the benefit state', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { visit } = claimService(pool);
  const inside = await visit(world, kst('2026-10-05T15:00:00'), kst('2026-10-05T15:01:00'));
  const outside = await visit(world, kst('2026-10-05T18:00:00'), kst('2026-10-05T18:01:00'));
  assert.equal(inside.redeemed.benefit?.state, 'ELIGIBLE');
  assert.equal(outside.redeemed.benefit?.state, 'OUTSIDE_WINDOW');

  const effects = async (customer: string) => ({
    visits: (await pool.query(`SELECT status, progress_counted, verification_level, progress_excluded_reason, business_date::text
      FROM visit_events WHERE customer_account_id = $1`, [customer])).rows,
    rewards: (await pool.query(`SELECT target_visit_count, status FROM reward_entitlements WHERE customer_account_id = $1 ORDER BY target_visit_count`, [customer])).rows,
    slots: (await pool.query(`SELECT status FROM claim_slots WHERE customer_account_id = $1`, [customer])).rows,
  });
  const insideEffects = await effects(inside.customer);
  const outsideEffects = await effects(outside.customer);
  assert.deepEqual(outsideEffects, insideEffects);
  assert.deepEqual(outsideEffects.visits, [{ status: 'VALID', progress_counted: true, verification_level: 'MERCHANT_CONFIRMED',
    progress_excluded_reason: null, business_date: '2026-10-05' }]);
  assert.deepEqual(outsideEffects.rewards, [{ target_visit_count: 1, status: 'GRANTED' }]);
  assert.deepEqual(outside.redeemed.grantedRewards.map(reward => reward.targetVisitCount), [1]);
  // 방문 시각(occurred_at)은 그대로 고객이 확정한 시각이다. 혜택 판정 때문에 값이 바뀌지 않는다.
  assert.equal((await pool.query<{ occurred_at: Date }>(`SELECT occurred_at FROM visit_events WHERE customer_account_id = $1`, [outside.customer])).rows[0]!.occurred_at.toISOString(),
    kst('2026-10-05T18:01:00').toISOString());

  // 같은 고객의 다음 방문도 창과 무관하게 진행에 센다(밖 → 3회째에 3번째 목표).
  const progress = async (hour: number, day: string) => (await visit(world, kst(`${day}T${hour}:00:00`), kst(`${day}T${hour}:02:00`), outside.customer)).redeemed;
  const second = await progress(20, '2026-10-06');
  const third = await progress(21, '2026-10-07');
  assert.equal(second.benefit?.state, 'OUTSIDE_WINDOW');
  assert.equal(second.visit.progressVisitCount, 2);
  assert.equal(third.visit.progressVisitCount, 3);
  assert.deepEqual(third.grantedRewards.map(reward => reward.targetVisitCount), [3]);
});

test('KST midnight and the 24:00 end: the Korean date decides the weekday, and the scan may fall on the next day', { skip }, async (t) => {
  const pool = await setup(t);
  // 월요일 23:00~24:00, 화요일 00:00~01:00.
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: [
    { days: [1], start: '23:00', end: '24:00' }, { days: [2], start: '00:00', end: '01:00' },
  ] });
  const { visit } = claimService(pool);
  // 월요일 23:59:59.999에 만든 코드는 월요일 창 안이고, 자정이 지난 00:05에 확정해도 혜택 대상이다.
  const beforeMidnight = await visit(world, kst('2026-10-05T23:59:59.999'), kst('2026-10-06T00:05:00'));
  assert.equal(beforeMidnight.issued.windowStatus, 'IN_WINDOW');
  assert.equal(beforeMidnight.redeemed.benefit?.state, 'ELIGIBLE');
  // 방문 날짜(business_date)는 확정 시각의 한국 날짜라 화요일이다. 혜택 판정과 날짜 판정은 따로다.
  assert.equal(beforeMidnight.redeemed.visit.businessDate, '2026-10-06');
  // 한국 자정 정각(UTC로는 월요일 15:00)은 화요일 창의 시작이다.
  const midnight = await visit(world, new Date('2026-10-05T15:00:00.000Z'), new Date('2026-10-05T15:02:00.000Z'));
  assert.equal(midnight.issued.windowStatus, 'IN_WINDOW');
  // 화요일 01:00:00.000은 창 밖, 00:59:59.999는 안.
  assert.equal((await visit(world, kst('2026-10-06T00:59:59.999'), kst('2026-10-06T01:02:00'))).issued.windowStatus, 'IN_WINDOW');
  assert.equal((await visit(world, kst('2026-10-06T01:00:00.000'), kst('2026-10-06T01:02:00'))).issued.windowStatus, 'OUTSIDE_WINDOW');
  // 월요일 22:59:59.999는 창 밖이다(23:00 시작).
  assert.equal((await visit(world, kst('2026-10-05T22:59:59.999'), kst('2026-10-05T23:02:00'))).redeemed.benefit?.state, 'OUTSIDE_WINDOW');
});

test('reissuing a code keeps the window status of the original creation time, and a reissue after the window still reports inside', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { service, clock } = claimService(pool);
  const customer = `cp-customer-${randomUUID()}`;
  clock.now = kst('2026-10-05T16:58:00');
  const issued = await service.issue({ merchantId: world.merchantId, customerAccountId: customer, merchantReference: 'reissue-ref', createdByAccountId: world.staffId });
  assert.equal(issued.windowStatus, 'IN_WINDOW');
  clock.now = kst('2026-10-05T17:03:00');
  const reissued = await service.reissue({ merchantId: world.merchantId, claimSlotId: issued.claimSlotId, expectedTokenVersion: 1, requestedByAccountId: world.staffId });
  assert.equal(reissued.tokenVersion, 2);
  assert.equal(reissued.windowStatus, 'IN_WINDOW');
  clock.now = kst('2026-10-05T17:04:00');
  const redeemed = await service.redeem({ accountId: customer, token: reissued.token });
  assert.equal(redeemed.benefit?.state, 'ELIGIBLE');

  // 창 밖에서 만든 코드는 재발급해도 밖이다.
  clock.now = kst('2026-10-05T18:00:00');
  const outside = await service.issue({ merchantId: world.merchantId, customerAccountId: `cp-customer-${randomUUID()}`, merchantReference: 'reissue-ref-2', createdByAccountId: world.staffId });
  assert.equal(outside.windowStatus, 'OUTSIDE_WINDOW');
  const outsideAgain = await service.reissue({ merchantId: world.merchantId, claimSlotId: outside.claimSlotId, expectedTokenVersion: 1, requestedByAccountId: world.staffId });
  assert.equal(outsideAgain.windowStatus, 'OUTSIDE_WINDOW');
});

test('the public catalog and the discovery detail carry the purpose only for a campaign that has one', { skip }, async (t) => {
  const pool = await setup(t);
  const withPurpose = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon, featured_menu_name: '라떼' });
  const legacy = await makeWorld(pool);
  const revisit = await makeWorld(pool, { purpose: 'REVISIT' });
  const now = kst('2026-10-05T12:00:00');
  const catalog = await new PostgresMerchantCatalog(pool, () => now).listPublicMerchants();
  const campaignOf = (merchantId: string) => catalog.find(merchant => merchant.id === merchantId)!.campaign;

  assert.deepEqual(campaignOf(withPurpose.merchantId).purpose, { kind: 'OFF_PEAK', featuredMenuName: '라떼', timeWindows: weekdayAfternoon });
  assert.deepEqual(campaignOf(revisit.merchantId).purpose, { kind: 'REVISIT', revisitMinDays: 1, revisitWindowDays: 14 });
  // 옛 캠페인은 필드 자체가 없다. 기존 enum 필드는 그대로다.
  assert.equal('purpose' in campaignOf(legacy.merchantId), false);
  assert.equal(campaignOf(legacy.merchantId).enrollmentStatus, 'OPEN');
  assert.deepEqual(Object.keys(campaignOf(legacy.merchantId)).sort(), ['endsAt', 'enrollmentStatus', 'id', 'rewardGoals', 'startsAt', 'title']);

  const realWorld = new PostgresRealWorldService(pool, { now: () => now, includeDemo: true });
  const detail = await realWorld.merchant(withPurpose.merchantId);
  assert.deepEqual(detail.campaign?.purpose, { kind: 'OFF_PEAK', featuredMenuName: '라떼', timeWindows: weekdayAfternoon });
  assert.equal(detail.campaign?.state, 'ACTIVE');
  const legacyDetail = await realWorld.merchant(legacy.merchantId);
  assert.equal('purpose' in (legacyDetail.campaign ?? {}), false);
});

test('a code reissued after its validity ended is judged when it is used, and one reissued within it by its creation time', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { service, clock } = claimService(pool);
  let n = 0;
  const issue = async (at: string) => {
    clock.now = kst(at);
    const customer = `cp-customer-${randomUUID()}`;
    const issued = await service.issue({ merchantId: world.merchantId, customerAccountId: customer, merchantReference: `ttl-ref-${++n}`, createdByAccountId: world.staffId });
    return { customer, issued };
  };
  const reissue = async (slot: { issued: { claimSlotId: string } }, at: string, version = 1) => {
    clock.now = kst(at);
    return service.reissue({ merchantId: world.merchantId, claimSlotId: slot.issued.claimSlotId, expectedTokenVersion: version, requestedByAccountId: world.staffId });
  };
  const redeem = async (slot: { customer: string }, token: string, at: string) => {
    clock.now = kst(at);
    return service.redeem({ accountId: slot.customer, token });
  };

  // 창 안(월 15:00)에 만든 코드를 유효 시간이 한참 지난 토요일 창 밖에 재발급해 쓰면 밖이다. 처음 만든 시각을 물려받지 않는다.
  const stale = await issue('2026-10-05T15:00:00');
  assert.equal(stale.issued.windowStatus, 'IN_WINDOW');
  const staleReissued = await reissue(stale, '2026-10-10T15:00:00');
  assert.equal(staleReissued.windowStatus, 'OUTSIDE_WINDOW');
  const staleRedeemed = await redeem(stale, staleReissued.token, '2026-10-10T15:02:00');
  assert.equal(staleRedeemed.benefit?.state, 'OUTSIDE_WINDOW');
  // 방문 인정은 그대로다(D1).
  assert.equal(staleRedeemed.visit.progressCounted, true);
  assert.deepEqual(staleRedeemed.grantedRewards.map(reward => reward.targetVisitCount), [1]);
  // 재시도는 처음 확정할 때 저장한 claimed_at으로 판정한다. 재시도 시각이 창 안이어도, 처음 만든 시각이 창 안이어도 바뀌지 않는다.
  const replay = await redeem(stale, staleReissued.token, '2026-10-12T15:00:00');
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.benefit, { state: 'OUTSIDE_WINDOW' });

  // 반대로 창 밖에서 만든 코드(월 18:00)를 며칠 뒤 창 안(수 15:00)에 재발급해 쓰면 그 시각 기준으로 안이다.
  const lateInside = await issue('2026-10-05T18:00:00');
  assert.equal(lateInside.issued.windowStatus, 'OUTSIDE_WINDOW');
  const lateReissued = await reissue(lateInside, '2026-10-07T15:00:00');
  assert.equal(lateReissued.windowStatus, 'IN_WINDOW');
  const lateRedeemed = await redeem(lateInside, lateReissued.token, '2026-10-07T15:01:00');
  assert.equal(lateRedeemed.benefit?.state, 'ELIGIBLE');
  assert.deepEqual((await redeem(lateInside, lateReissued.token, '2026-10-09T20:00:00')).benefit, { state: 'ELIGIBLE' });

  // 유효 시간 안(16:50에 만들고 17:04:59.999까지)이면 만든 시각이 기준이다. 정확히 만든 시각 + 15분부터는 확정 시각이 기준이다.
  const edgeIn = await issue('2026-10-05T16:50:00');
  const edgeInReissued = await reissue(edgeIn, '2026-10-05T16:55:00');
  assert.equal(edgeInReissued.windowStatus, 'IN_WINDOW');
  assert.equal((await redeem(edgeIn, edgeInReissued.token, '2026-10-05T17:04:59.999')).benefit?.state, 'ELIGIBLE');
  const edgeOut = await issue('2026-10-05T16:50:00');
  const edgeOutReissued = await reissue(edgeOut, '2026-10-05T16:55:00');
  assert.equal((await redeem(edgeOut, edgeOutReissued.token, '2026-10-05T17:05:00.000')).benefit?.state, 'OUTSIDE_WINDOW');
  // 재발급 요청 자체도 같은 경계를 쓴다: 만든 시각 + 15분 정각의 재발급은 요청 시각(창 밖)이 기준이다.
  const edgeReissue = await issue('2026-10-05T16:50:00');
  assert.equal((await reissue(edgeReissue, '2026-10-05T17:04:59.999')).windowStatus, 'IN_WINDOW');
  assert.equal((await reissue(edgeReissue, '2026-10-05T17:05:00.000', 2)).windowStatus, 'OUTSIDE_WINDOW');
});

test('a visit that does not count toward progress never carries a benefit: staff self-claim and a second visit on the same day', { skip }, async (t) => {
  const pool = await setup(t);
  const world = await makeWorld(pool, { purpose: 'OFF_PEAK', time_windows: weekdayAfternoon });
  const { service, visit } = claimService(pool);

  // 같은 한국 날짜의 두 번째 방문은 창 안이어도 진행에 세지 않으므로 혜택도 없다. 재생도 같다.
  const first = await visit(world, kst('2026-10-05T15:00:00'), kst('2026-10-05T15:01:00'));
  assert.equal(first.redeemed.visit.progressCounted, true);
  assert.deepEqual(first.redeemed.benefit, { state: 'ELIGIBLE' });
  const second = await visit(world, kst('2026-10-05T15:30:00'), kst('2026-10-05T15:31:00'), first.customer);
  assert.equal(second.issued.windowStatus, 'IN_WINDOW');
  assert.equal(second.redeemed.visit.progressCounted, false);
  assert.equal(second.redeemed.visit.progressExcludedReason, undefined);
  assert.deepEqual(second.redeemed.benefit, { state: 'NONE' });
  assert.deepEqual((await service.redeem({ accountId: first.customer, token: second.issued.token })).benefit, { state: 'NONE' });
  // 다음 날 첫 방문은 다시 세어지고 혜택 대상이다.
  const nextDay = await visit(world, kst('2026-10-06T15:00:00'), kst('2026-10-06T15:01:00'), first.customer);
  assert.deepEqual(nextDay.redeemed.benefit, { state: 'ELIGIBLE' });

  // 실제 점포에서 직원이 자기 계정으로 받은 방문은 기록만 하고 세지 않으며, 창 안이어도 혜택은 없다. 재생도 같다.
  await pool.query(`UPDATE merchants SET is_demo = false WHERE id = $1`, [world.merchantId]);
  const self = await visit(world, kst('2026-10-07T15:00:00'), kst('2026-10-07T15:01:00'), world.staffId);
  assert.equal(self.issued.windowStatus, 'IN_WINDOW');
  assert.equal(self.redeemed.visit.progressCounted, false);
  assert.equal(self.redeemed.visit.progressExcludedReason, 'STAFF_SELF');
  assert.deepEqual(self.redeemed.benefit, { state: 'NONE' });
  const selfReplay = await service.redeem({ accountId: world.staffId, token: self.issued.token });
  assert.equal(selfReplay.replayed, true);
  assert.deepEqual(selfReplay.benefit, { state: 'NONE' });
  // 직원이 아닌 고객은 같은 점포·같은 시각에 혜택 대상이다.
  assert.deepEqual((await visit(world, kst('2026-10-07T15:00:00'), kst('2026-10-07T15:01:00'))).redeemed.benefit, { state: 'ELIGIBLE' });
});
