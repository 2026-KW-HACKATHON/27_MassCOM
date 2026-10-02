import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresVisitorFeedbackService } from './postgres/visitor-feedback.js';
import { maskedCustomerLabel } from './reversal-rules.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const hmacSecret = 'test-only-visitor-feedback-account-secret-at-least-32-bytes';
const labelSecret = 'test-only-visitor-feedback-label-secret-at-least-32-bytes';

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE account_deletion_requests, merchant_visitor_feedback, showcase_guest_trials, reward_entitlements,
       visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE`,
  );
  const state = { now: new Date('2026-10-03T00:00:00.000Z') };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  return {
    pool,
    state,
    now,
    feedback: new PostgresVisitorFeedbackService(pool, { accountLifecycle: lifecycle, labelHmacSecret: labelSecret, now }),
    catalog: new PostgresMerchantCatalog(pool, now),
    deletion: new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', now, accountLifecycle: lifecycle,
    }),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

const rejectsWith = (code: string) => ({ code });
const empty = { tags: [], suggestions: [], note: null };
const rowCount = async (pool: Pool, where = 'true', params: unknown[] = []) =>
  (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM merchant_visitor_feedback WHERE ${where}`, params)).rows[0]!.n;

async function addMerchant(pool: Pool, id: string, options: { isDemo?: boolean } = {}): Promise<void> {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', $3)`,
    [id, `가게 ${id}`, options.isDemo ?? false],
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, 'staff', 'STAFF', 'ACTIVE')`,
    [id],
  );
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, '시험 캠페인', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 100)`,
    [`campaign-${id}`, id],
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, 1, '첫'), ($1, 3, '셋'), ($1, 5, '다섯')`,
    [`campaign-${id}`],
  );
}

async function addVisit(pool: Pool, input: {
  account: string; merchant: string; date?: string; status?: 'VALID' | 'CANCELED'; excluded?: 'STAFF_SELF';
}): Promise<void> {
  const claimSlotId = randomUUID();
  // 직원 본인 적립은 직원 계정이 그 가게의 멤버여야 만들어진다(claim_slots의 멤버 FK).
  if (input.excluded) {
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')
       ON CONFLICT DO NOTHING`,
      [input.merchant, input.account],
    );
  }
  const date = input.date ?? '2026-09-20';
  const at = `${date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes',
               $7, $7::timestamptz - interval '5 minutes', $7)`,
    [claimSlotId, input.merchant, input.account, randomBytes(32), input.excluded ? input.account : 'staff',
      randomBytes(32), at],
  );
  const canceled = input.status === 'CANCELED';
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at, business_date,
       verification_level, status, progress_counted, cancellation_reason, progress_excluded_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', $8, $9, $10, $11)`,
    [randomUUID(), claimSlotId, input.merchant, `campaign-${input.merchant}`, input.account, at, date,
      canceled ? 'CANCELED' : 'VALID', !canceled && !input.excluded, canceled ? '시험 취소' : null, input.excluded ?? null],
  );
}

// 방문 자격을 갖춘 손님이 같은 가게에 태그를 남긴 상태를 직접 만든다(집계·요약 시험용).
async function vote(db: Db, account: string, merchant: string, input: { tags?: string[]; suggestions?: string[]; note?: string | null }): Promise<void> {
  await addVisit(db.pool, { account, merchant });
  await db.feedback.upsert(account, merchant, { ...empty, ...input });
}

test('migration 0040 creates the feedback table with its key, index and the code, count and note checks', async (t) => {
  const { pool } = await setup(t);
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM schema_migrations WHERE filename = '0040_merchant_visitor_feedback.sql'`,
  )).rows[0]!.n, 1);
  await addMerchant(pool, 'shop-a');
  const insert = (tags: string, suggestions: string, note: string | null) => pool.query(
    `INSERT INTO merchant_visitor_feedback (customer_account_id, merchant_id, tags, suggestions, note)
     VALUES ('acct-check', 'shop-a', $1::text[], $2::text[], $3)`,
    [tags, suggestions, note],
  );
  const rejected = async (tags: string, suggestions: string, note: string | null, constraint: string) => {
    await assert.rejects(insert(tags, suggestions, note), (error: { code?: string; constraint?: string }) =>
      error.code === '23514' && error.constraint === constraint, `${tags} ${suggestions} ${note}`);
    assert.equal(await rowCount(pool), 0);
  };
  await rejected('{UNKNOWN}', '{}', null, 'merchant_visitor_feedback_tags_check');
  await rejected('{SOLO,TAKEOUT,GENEROUS,QUIET}', '{}', null, 'merchant_visitor_feedback_tags_check');
  await rejected('{SOLO,SOLO}', '{}', null, 'merchant_visitor_feedback_tags_check');
  await rejected('{SOLO,NULL}', '{}', null, 'merchant_visitor_feedback_tags_check');
  await rejected('{{SOLO,SOLO,KIND}}', '{}', null, 'merchant_visitor_feedback_tags_check');
  await rejected('{}', '{TAKEOUT}', null, 'merchant_visitor_feedback_suggestions_check');
  await rejected('{}', '{SOLO_MENU,SPICE_LABEL,MORE_PHOTOS}', null, 'merchant_visitor_feedback_suggestions_check');
  await rejected('{}', '{HOURS_INFO,HOURS_INFO}', null, 'merchant_visitor_feedback_suggestions_check');
  await rejected('{KIND}', '{}', '가'.repeat(101), 'merchant_visitor_feedback_note_check');
  await rejected('{KIND}', '{}', '   ', 'merchant_visitor_feedback_note_check');
  await rejected('{}', '{}', null, 'merchant_visitor_feedback_not_empty_check');
  // 경계값은 들어간다: 태그 3개·바라는 점 2개·100자 의견.
  await insert('{SOLO,TAKEOUT,GENEROUS}', '{SOLO_MENU,HOURS_INFO}', '가'.repeat(100));
  assert.equal(await rowCount(pool), 1);
  // 계정·가게당 한 줄이고 없는 가게는 가리킬 수 없다.
  await assert.rejects(insert('{KIND}', '{}', null), { code: '23505' });
  await assert.rejects(pool.query(
    `INSERT INTO merchant_visitor_feedback (customer_account_id, merchant_id, tags) VALUES ('acct-check', 'no-such-shop', '{KIND}')`,
  ), { code: '23503' });
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'merchant_visitor_feedback' AND indexdef LIKE '%(merchant_id)%'`,
  )).rows[0]!.n, 1);
});

test('a visitor with a counted visit can save, re-save overwrites the single row, and getMine reads it back', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addVisit(db.pool, { account: 'customer-1', merchant: 'shop-a' });
  assert.deepEqual(await db.feedback.getMine('customer-1', 'shop-a'), empty);

  const first = await db.feedback.upsert('customer-1', 'shop-a', {
    tags: ['KIND', 'SOLO', 'KIND'], suggestions: ['HOURS_INFO'], note: '  국물이   진해요 ',
  });
  assert.deepEqual(first, { tags: ['SOLO', 'KIND'], suggestions: ['HOURS_INFO'], note: '국물이 진해요' });
  assert.deepEqual(await db.feedback.getMine('customer-1', 'shop-a'), first);
  const created = (await db.pool.query<{ created_at: Date }>('SELECT created_at FROM merchant_visitor_feedback')).rows[0]!.created_at;
  assert.equal(created.toISOString(), '2026-10-03T00:00:00.000Z');

  db.state.now = new Date('2026-10-04T05:00:00.000Z');
  const second = await db.feedback.upsert('customer-1', 'shop-a', { tags: ['VALUE'], suggestions: [], note: null });
  assert.deepEqual(second, { tags: ['VALUE'], suggestions: [], note: null });
  assert.deepEqual(await db.feedback.getMine('customer-1', 'shop-a'), second);
  assert.equal(await rowCount(db.pool), 1, 'one row per account and store');
  const row = (await db.pool.query<{ created_at: Date; updated_at: Date }>(
    'SELECT created_at, updated_at FROM merchant_visitor_feedback')).rows[0]!;
  assert.equal(row.created_at.toISOString(), created.toISOString(), 'created_at stays');
  assert.equal(row.updated_at.toISOString(), '2026-10-04T05:00:00.000Z');
  // 다른 손님·다른 가게의 선택은 건드리지 않는다.
  assert.deepEqual(await db.feedback.getMine('customer-2', 'shop-a'), empty);
});

test('saving all three empty deletes the row, also for someone who can no longer save', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addVisit(db.pool, { account: 'customer-1', merchant: 'shop-a' });
  await db.feedback.upsert('customer-1', 'shop-a', { tags: ['KIND'], suggestions: ['MORE_PHOTOS'], note: '좋아요' });
  assert.equal(await rowCount(db.pool), 1);
  // 공백뿐인 의견도 비어 있는 것이다.
  assert.deepEqual(await db.feedback.upsert('customer-1', 'shop-a', { tags: [], suggestions: [], note: '  \n ' }), empty);
  assert.equal(await rowCount(db.pool), 0);
  assert.deepEqual(await db.feedback.getMine('customer-1', 'shop-a'), empty);
  // 지울 행이 없어도 오류가 아니다.
  assert.deepEqual(await db.feedback.upsert('customer-1', 'shop-a', empty), empty);

  // 방문이 취소돼 자격을 잃어도 이미 남긴 선택은 스스로 거둘 수 있다.
  await db.feedback.upsert('customer-1', 'shop-a', { tags: ['KIND'], suggestions: [], note: null });
  await db.pool.query(
    `UPDATE visit_events SET status = 'CANCELED', progress_counted = false, cancellation_reason = '시험 취소'`);
  await assert.rejects(
    db.feedback.upsert('customer-1', 'shop-a', { tags: ['KIND'], suggestions: [], note: null }),
    rejectsWith('VISITOR_FEEDBACK_NOT_ELIGIBLE'),
  );
  assert.deepEqual(await db.feedback.upsert('customer-1', 'shop-a', empty), empty);
  assert.equal(await rowCount(db.pool), 0);
});

test('only a counted, valid visit to that very store qualifies, and a trial store never does', async (t) => {
  const db = await setup(t);
  for (const shop of ['shop-a', 'shop-b', 'shop-c', 'trial-shop']) await addMerchant(db.pool, shop);
  const save = (account: string, merchant: string) =>
    db.feedback.upsert(account, merchant, { tags: ['KIND'], suggestions: [], note: null });
  const notEligible = rejectsWith('VISITOR_FEEDBACK_NOT_ELIGIBLE');

  await assert.rejects(save('nobody', 'shop-a'), notEligible, 'no visit');
  await assert.rejects(save('nobody', 'no-such-shop'), notEligible, 'unknown store');
  await addVisit(db.pool, { account: 'visited-b', merchant: 'shop-b' });
  await assert.rejects(save('visited-b', 'shop-a'), notEligible, 'a visit to another store does not count');
  await addVisit(db.pool, { account: 'canceled', merchant: 'shop-a', status: 'CANCELED' });
  await assert.rejects(save('canceled', 'shop-a'), notEligible, 'a canceled visit does not count');
  await addVisit(db.pool, { account: 'staff-self', merchant: 'shop-a', excluded: 'STAFF_SELF' });
  await assert.rejects(save('staff-self', 'shop-a'), notEligible, 'a staff self-claim does not count');
  assert.equal(await rowCount(db.pool), 0);

  // 취소된 방문 옆에 유효한 방문이 하나라도 있으면 된다.
  await addVisit(db.pool, { account: 'canceled', merchant: 'shop-a', date: '2026-09-21' });
  assert.deepEqual((await save('canceled', 'shop-a')).tags, ['KIND']);
  assert.deepEqual((await save('visited-b', 'shop-b')).tags, ['KIND']);

  // 로그인 없는 체험 가게(#309)는 방문이 있어도 쓸 수 없다.
  await addVisit(db.pool, { account: 'trialist', merchant: 'trial-shop' });
  await db.pool.query(
    `INSERT INTO showcase_guest_trials (account_id, merchant_id, expires_at) VALUES ('trialist', 'trial-shop', now() + interval '1 day')`);
  await assert.rejects(save('trialist', 'trial-shop'), notEligible, 'a trial store does not accept feedback');
  assert.equal(await rowCount(db.pool, `merchant_id = 'trial-shop'`), 0);
});

test('invalid tags, suggestions and notes are rejected with distinct codes before anything is written', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addVisit(db.pool, { account: 'customer-1', merchant: 'shop-a' });
  const save = (input: { tags: unknown; suggestions: unknown; note: unknown }) => db.feedback.upsert('customer-1', 'shop-a', input);

  await assert.rejects(save({ ...empty, tags: ['UNKNOWN'] }), rejectsWith('VISITOR_FEEDBACK_TAGS_INVALID'));
  await assert.rejects(save({ ...empty, tags: ['SOLO', 'TAKEOUT', 'GENEROUS', 'QUIET'] }), rejectsWith('VISITOR_FEEDBACK_TAGS_INVALID'));
  await assert.rejects(save({ ...empty, suggestions: ['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS'] }), rejectsWith('VISITOR_FEEDBACK_SUGGESTIONS_INVALID'));
  await assert.rejects(save({ ...empty, suggestions: ['KIND'] }), rejectsWith('VISITOR_FEEDBACK_SUGGESTIONS_INVALID'));
  // 개인정보(이메일·주소·긴 숫자열)가 보이거나 100자를 넘는 의견은 저장하지 않는다.
  for (const note of ['연락처 a.b@example.com', 'https://example.com/me', '010 1234 5678', '가'.repeat(101)]) {
    await assert.rejects(save({ ...empty, tags: ['KIND'], note }), rejectsWith('VISITOR_FEEDBACK_NOTE_INVALID'), note);
  }
  assert.equal(await rowCount(db.pool), 0);
  // 틀린 저장은 이미 있는 선택도 바꾸지 않는다.
  await save({ ...empty, tags: ['KIND'] });
  await assert.rejects(save({ ...empty, tags: ['QUIET'], note: 'a@b.kr' }), rejectsWith('VISITOR_FEEDBACK_NOTE_INVALID'));
  assert.deepEqual(await db.feedback.getMine('customer-1', 'shop-a'), { ...empty, tags: ['KIND'] });
});

test('the public catalog shows a tag on a real store from 3 votes and on a demo store from 1, never suggestions or notes', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'real-shop');
  await addMerchant(db.pool, 'demo-shop', { isDemo: true });
  await addMerchant(db.pool, 'quiet-shop');
  const tagsOf = async (merchant: string) =>
    (await db.catalog.listPublicMerchants()).find((entry) => entry.id === merchant)?.visitorTags;

  // 실제 점포: KIND 3표·SOLO 2표·VALUE 1표. 3표 이상인 KIND만 나온다.
  await vote(db, 'a1', 'real-shop', { tags: ['SOLO', 'KIND', 'VALUE'], suggestions: ['HOURS_INFO'], note: '비밀 의견' });
  await vote(db, 'a2', 'real-shop', { tags: ['SOLO', 'KIND'] });
  assert.deepEqual(await tagsOf('real-shop'), [], '2 votes stay hidden');
  await vote(db, 'a3', 'real-shop', { tags: ['KIND'] });
  assert.deepEqual(await tagsOf('real-shop'), [{ code: 'KIND', count: 3 }], '3 votes are shown, 2 and 1 stay hidden');
  await vote(db, 'a4', 'real-shop', { tags: ['SOLO', 'QUIET'] });
  await vote(db, 'a5', 'real-shop', { tags: ['QUIET', 'SOLO'] });
  await vote(db, 'a6', 'real-shop', { tags: ['QUIET'] });
  // 개수 내림차순(SOLO 4, KIND 3, QUIET 3)이고 같은 개수는 정해진 코드 순서(QUIET가 KIND보다 앞)다.
  assert.deepEqual(await tagsOf('real-shop'), [
    { code: 'SOLO', count: 4 }, { code: 'QUIET', count: 3 }, { code: 'KIND', count: 3 },
  ]);

  // 시연 점포는 1표부터 보인다.
  assert.deepEqual(await tagsOf('demo-shop'), []);
  await vote(db, 'a1', 'demo-shop', { tags: ['DESSERT'], suggestions: ['SOLO_MENU'], note: '시연 의견' });
  assert.deepEqual(await tagsOf('demo-shop'), [{ code: 'DESSERT', count: 1 }]);

  // 피드백이 없는 점포도 목록에 나오고 순서는 이름 순 그대로다.
  assert.deepEqual(await tagsOf('quiet-shop'), []);
  const listed = await db.catalog.listPublicMerchants();
  assert.deepEqual(listed.map((entry) => entry.id), ['demo-shop', 'quiet-shop', 'real-shop']);
  // 바라는 점·의견은 어디에도 실리지 않는다.
  const text = JSON.stringify(listed);
  for (const secret of ['HOURS_INFO', 'SOLO_MENU', '비밀 의견', '시연 의견', 'suggestions', 'note']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test('the store summary counts every tag and suggestion, lists the latest notes with a masked label and a date only', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addMerchant(db.pool, 'shop-b');
  db.state.now = new Date('2026-10-02T16:30:00.000Z'); // KST 2026-10-03 01:30
  await vote(db, 'customer-1', 'shop-a', { tags: ['KIND'], suggestions: ['HOURS_INFO', 'SOLO_MENU'], note: '또 올게요' });
  db.state.now = new Date('2026-10-03T14:59:59.000Z'); // KST 2026-10-03 23:59:59
  await vote(db, 'customer-2', 'shop-a', { tags: ['KIND', 'SOLO'], suggestions: ['HOURS_INFO'], note: null });
  db.state.now = new Date('2026-10-03T15:00:00.000Z'); // KST 2026-10-04 00:00:00
  await vote(db, 'customer-3', 'shop-a', { tags: ['VALUE'], suggestions: [], note: '가성비 최고' });
  // 다른 가게의 선택은 섞이지 않는다.
  await vote(db, 'customer-1', 'shop-b', { tags: ['DESSERT'], suggestions: ['MORE_PHOTOS'], note: '다른 가게 의견' });

  const summary = await db.feedback.merchantSummary('shop-a');
  // 점포 안에서는 기준 없이 1표도 센다. 개수 내림차순 뒤 코드 순서.
  assert.deepEqual(summary.tags, [
    { code: 'KIND', label: '친절해요', count: 2 },
    { code: 'SOLO', label: '혼밥하기 좋아요', count: 1 },
    { code: 'VALUE', label: '가성비가 좋아요', count: 1 },
  ]);
  assert.deepEqual(summary.suggestions, [
    { code: 'HOURS_INFO', label: '영업시간 안내가 있으면 좋겠어요', count: 2 },
    { code: 'SOLO_MENU', label: '혼밥 메뉴가 있으면 좋겠어요', count: 1 },
  ]);
  // 의견은 최근 것부터이고 의견 없는 손님은 빠진다. 표시는 가린 라벨, 날짜는 한국 날짜뿐이다.
  assert.deepEqual(summary.notes, [
    { customerLabel: maskedCustomerLabel(labelSecret, 'shop-a', 'customer-3'), date: '2026-10-04', text: '가성비 최고' },
    { customerLabel: maskedCustomerLabel(labelSecret, 'shop-a', 'customer-1'), date: '2026-10-03', text: '또 올게요' },
  ]);
  for (const note of summary.notes) assert.match(note.customerLabel, /^손님 [A-Z2-9]{4}$/);
  const text = JSON.stringify(summary);
  assert.equal(/customer-\d|accountId|T\d\d:\d\d|Z"/.test(text), false, 'no account id and no time of day');
  assert.equal(text.includes('다른 가게 의견'), false);
  // 가게마다 가림 표시가 다르다(같은 손님이어도 두 가게의 표시를 이어 붙일 수 없다).
  const other = await db.feedback.merchantSummary('shop-b');
  assert.equal(other.notes[0]!.customerLabel, maskedCustomerLabel(labelSecret, 'shop-b', 'customer-1'));
  assert.notEqual(other.notes[0]!.customerLabel, maskedCustomerLabel(labelSecret, 'shop-a', 'customer-1'));
  assert.deepEqual(await db.feedback.merchantSummary('no-such-shop'), { tags: [], suggestions: [], notes: [] });
});

test('the store summary lists at most the latest 50 notes', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  for (let index = 1; index <= 52; index += 1) {
    const account = `visitor-${String(index).padStart(2, '0')}`;
    await addVisit(db.pool, { account, merchant: 'shop-a' });
    db.state.now = new Date(Date.UTC(2026, 9, 3, 0, index));
    await db.feedback.upsert(account, 'shop-a', { tags: [], suggestions: [], note: `의견 ${index}` });
  }
  const { notes } = await db.feedback.merchantSummary('shop-a');
  assert.equal(notes.length, 50);
  assert.equal(notes[0]!.text, '의견 52');
  assert.equal(notes[49]!.text, '의견 3');
});

test('deleting an account removes its feedback rows and a deleting account cannot write', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addMerchant(db.pool, 'shop-b');
  await vote(db, 'leaver', 'shop-a', { tags: ['KIND'], suggestions: ['HOURS_INFO'], note: '떠나는 손님' });
  await vote(db, 'leaver', 'shop-b', { tags: ['SOLO'] });
  await vote(db, 'stayer', 'shop-a', { tags: ['KIND'], note: '남는 손님' });
  assert.equal(await rowCount(db.pool), 3);

  await db.deletion.requestDeletion({ accountId: 'leaver', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal(await rowCount(db.pool, 'customer_account_id = $1', ['leaver']), 0);
  assert.equal(await rowCount(db.pool, `position($1 in customer_account_id) > 0`, ['leaver']), 0, 'no raw ID, pseudonym or otherwise');
  assert.equal(await rowCount(db.pool), 1, "someone else's row stays");
  assert.deepEqual((await db.feedback.merchantSummary('shop-a')).notes.map((note) => note.text), ['남는 손님']);
  assert.deepEqual(await db.feedback.getMine('leaver', 'shop-a'), empty);
  await assert.rejects(
    db.feedback.upsert('leaver', 'shop-a', { tags: ['KIND'], suggestions: [], note: null }),
    rejectsWith('ACCOUNT_DELETED'),
  );
  await assert.rejects(
    db.feedback.upsert('leaver', 'shop-a', empty),
    rejectsWith('ACCOUNT_DELETED'),
    'even withdrawing is refused for a deleted account',
  );
  assert.equal(await rowCount(db.pool, 'customer_account_id = $1', ['leaver']), 0);
});

test('over HTTP, an account without a visit gets 403 and one with a visit saves and reads back its own selection', async (t) => {
  const db = await setup(t);
  await addMerchant(db.pool, 'shop-a');
  await addMerchant(db.pool, 'shop-b');
  await addVisit(db.pool, { account: 'customer-1', merchant: 'shop-a' });
  const walletService = new WalletChallengeService({
    store: new InMemoryChallengeStore(), domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532, ttlMs: 5 * 60 * 1000,
  });
  // visitorFeedback은 createApiServer의 33번째 인자다. 사이의 서비스는 쓰지 않으므로 undefined로 채운다.
  const start = createApiServer as (...args: unknown[]) => ReturnType<typeof createApiServer>;
  const server = start(walletService, developmentHeaderAccountResolver, db.catalog,
    ...Array<undefined>(29).fill(undefined), db.feedback);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
  const call = (merchant: string, method: string, account: string, body?: object) =>
    fetch(`http://127.0.0.1:${address.port}/me/merchant-feedback/${merchant}`, {
      method,
      headers: { 'x-account-id': account, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const selection = { tags: ['QUIET', 'SOLO'], suggestions: ['SPICE_LABEL'], note: '조용해요' };

  const stranger = await call('shop-a', 'PUT', 'stranger', selection);
  assert.equal(stranger.status, 403);
  assert.deepEqual(await stranger.json(), { code: 'VISITOR_FEEDBACK_NOT_ELIGIBLE' });
  // 다른 가게에 간 손님은 이 가게에 쓸 수 없다.
  const wrongStore = await call('shop-b', 'PUT', 'customer-1', selection);
  assert.equal(wrongStore.status, 403);
  const saved = await call('shop-a', 'PUT', 'customer-1', selection);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { tags: ['SOLO', 'QUIET'], suggestions: ['SPICE_LABEL'], note: '조용해요' });
  const mine = await call('shop-a', 'GET', 'customer-1');
  assert.deepEqual(await mine.json(), { tags: ['SOLO', 'QUIET'], suggestions: ['SPICE_LABEL'], note: '조용해요' });
  // 다른 계정은 남의 선택을 읽지 못한다(자기 것만 온다).
  assert.deepEqual(await (await call('shop-a', 'GET', 'stranger')).json(), empty);
  const badTag = await call('shop-a', 'PUT', 'customer-1', { ...selection, tags: ['NOPE'] });
  assert.equal(badTag.status, 400);
  assert.deepEqual(await badTag.json(), { code: 'VISITOR_FEEDBACK_TAGS_INVALID' });
  const badNote = await call('shop-a', 'PUT', 'customer-1', { ...selection, note: 'x@y.kr' });
  assert.equal(badNote.status, 400);
  assert.deepEqual(await badNote.json(), { code: 'VISITOR_FEEDBACK_NOTE_INVALID' });
  assert.deepEqual(await (await call('shop-a', 'GET', 'customer-1')).json(), { tags: ['SOLO', 'QUIET'], suggestions: ['SPICE_LABEL'], note: '조용해요' });
});
