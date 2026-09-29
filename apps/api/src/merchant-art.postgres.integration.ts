import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { OpenAiImageClient, type AiArtImageClient } from './ai-art-client.js';
import {
  artStyles,
  kstMonthRange,
  resolveAiArtConfig,
  type AiArtConfig,
} from './ai-art-rules.js';
import {
  errorResponse,
  fakeDraftCostMicroUsd,
  fakeFinalCostMicroUsd,
  fakeOpenAiFetch,
  hangingFetch,
  type FakeOpenAiHandler,
} from './ai-art-test-support.js';
import { MerchantAccessError } from './merchant-access.js';
import { MerchantArtError, type ArtRoundView } from './merchant-art.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantArtService } from './postgres/merchant-art.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
const merchantIds = ['art-a', 'art-b', 'art-c', 'art-d', 'art-e', 'art-f'] as const;
const day = 24 * 60 * 60 * 1000;
// 한국 2026-09-29 12:00.
const noon = new Date('2026-09-29T03:00:00.000Z');

type Gate = { opened: Promise<void>; release: () => void };

// 열릴 때까지 OpenAI 응답을 붙잡는 문. setup이 시험이 끝나거나 실패할 때 반드시 연다.
function makeGate(): Gate {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { opened, release };
}

type SetupOptions = {
  gate?: Gate;
  config?: Partial<Pick<AiArtConfig, 'monthlyBudgetMicroUsd' | 'dailyDraftRounds' | 'dailyFinals'>>;
  handler?: FakeOpenAiHandler;
  fetch?: typeof fetch;
  timeoutMs?: number;
  staleAfterMs?: number;
  heartbeatMs?: number;
  client?: AiArtImageClient | 'none';
  lifecycle?: boolean;
};

async function setup(t: TestContext, options: SetupOptions = {}) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE merchant_art_images, merchant_art_rounds, merchant_art, ai_art_spend, account_deletion_requests,
              merchant_members, campaign_goals, campaigns, merchants CASCADE`,
  );
  for (const id of merchantIds) {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo, menu_items)
       VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', true, $3::jsonb)`,
      [id, id === 'art-a' ? '고래 분식' : `가상 ${id}`, JSON.stringify([
        { name: '라면', priceWon: 4500 }, { name: '김밥', priceWon: 3500 }, { name: '우동', priceWon: 6000 },
        { name: '돈까스', priceWon: 8000 }, { name: '떡볶이', priceWon: 5000 }, { name: '순대', priceWon: 5000 },
      ])],
    );
  }
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at) VALUES
       ('art-a', 'owner-a', 'OWNER', 'ACTIVE', NULL),
       ('art-a', 'staff-a', 'STAFF', 'ACTIVE', NULL),
       ('art-a', 'gone-a', 'STAFF', 'REVOKED', now()),
       ('art-b', 'staff-b', 'STAFF', 'ACTIVE', NULL)`,
  );
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('art-campaign-a', 'art-a', '도감', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 100)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ('art-campaign-a', 1, '하나'), ('art-campaign-a', 3, '셋'), ('art-campaign-a', 5, '다섯')`,
  );

  const state = { now: noon };
  const now = () => state.now;
  const handler: FakeOpenAiHandler | undefined = options.gate
    ? async (call, index) => { await options.gate!.opened; return options.handler?.(call, index); }
    : options.handler;
  const fake = fakeOpenAiFetch(handler);
  const logs: unknown[] = [];
  const client = options.client === 'none' ? undefined : options.client ?? new OpenAiImageClient({
    apiKey: 'test-only-openai-key', baseUrl: 'http://127.0.0.1:9', draftModel: 'draft-model', finalModel: 'final-model',
    fetch: options.fetch ?? fake.fetch, sleep: async () => {}, random: () => 0, log: (event) => logs.push(event),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  const defaults = resolveAiArtConfig({});
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  const art = new PostgresMerchantArtService(pool, {
    ...(client ? { client } : {}),
    config: { ...defaults, ...options.config },
    ...(options.lifecycle ? { accountLifecycle: lifecycle } : {}),
    now,
    ...(options.staleAfterMs !== undefined ? { staleAfterMs: options.staleAfterMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  t.after(async () => {
    options.gate?.release();
    await art.drain();
    await pool.end();
  });
  return { pool, art, state, now, fake, logs, lifecycle };
}

type Db = Awaited<ReturnType<typeof setup>>;

const rejectsWith = (code: string, retryAfterSeconds?: number) => (error: unknown) =>
  error instanceof MerchantArtError && error.code === code
  && (retryAfterSeconds === undefined || error.retryAfterSeconds === retryAfterSeconds);

const spendRows = async (pool: Pool) =>
  (await pool.query<{ merchant_id: string | null; kind: string; micro_usd: string }>(
    'SELECT merchant_id, kind, micro_usd::text FROM ai_art_spend ORDER BY id',
  )).rows.map((row) => ({ merchantId: row.merchant_id, kind: row.kind, microUsd: Number(row.micro_usd) }));

const totalSpend = async (pool: Pool) =>
  Number((await pool.query<{ total: string }>(
    'SELECT coalesce(sum(micro_usd), 0)::text AS total FROM ai_art_spend',
  )).rows[0]!.total);

async function readyRound(db: Db, merchantId = 'art-a', accountId = 'staff-a'): Promise<ArtRoundView> {
  const started = await db.art.createRound({ merchantId, accountId });
  await db.art.drain();
  const round = await db.art.getRound({ merchantId, roundId: started.id });
  assert.equal(round.status, 'DRAFTS_READY');
  return round;
}

async function finalRound(db: Db, merchantId = 'art-a', index = 1): Promise<ArtRoundView> {
  const round = await readyRound(db, merchantId);
  await db.art.chooseDraft({ merchantId, roundId: round.id, index });
  await db.art.drain();
  const final = await db.art.getRound({ merchantId, roundId: round.id });
  assert.equal(final.status, 'FINAL_READY');
  return final;
}

// ---------------------------------------------------------------------------------------------

test('migration 0029 creates the art tables with their constraints and the single in-progress index', async (t) => {
  const { pool } = await setup(t);
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM schema_migrations WHERE filename = '0029_merchant_art.sql'`,
  )).rows[0]!.n, 1);
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('merchant_art_rounds', 'merchant_art_images', 'merchant_art', 'ai_art_spend')`,
  );
  assert.equal(tables.rowCount, 4);

  const insertRound = (status: string, merchantId = 'art-a', chosen: number | null = null) => pool.query(
    `INSERT INTO merchant_art_rounds (id, merchant_id, status, chosen_index, business_date)
     VALUES ($1, $2, $3, $4, '2026-09-29')`,
    [randomUUID(), merchantId, status, chosen],
  );
  await assert.rejects(insertRound('WAITING'), /check/i);
  await assert.rejects(insertRound('DRAFTS_READY', 'art-a', 4), /check/i);
  await assert.rejects(insertRound('DRAFTS_READY', 'art-a', -1), /check/i);
  await assert.rejects(insertRound('DRAFTING', 'no-such-merchant'), /foreign key/i);

  // 진행 중(DRAFTING·FINALIZING)은 가게당 하나뿐이고, 끝난 라운드는 얼마든지 있을 수 있다.
  await insertRound('DRAFTING', 'art-a');
  await assert.rejects(insertRound('DRAFTING', 'art-a'), /merchant_art_rounds_one_in_progress/);
  await assert.rejects(insertRound('FINALIZING', 'art-a'), /merchant_art_rounds_one_in_progress/);
  await insertRound('DRAFTING', 'art-b');
  await insertRound('FAILED', 'art-a');
  await insertRound('DRAFTS_READY', 'art-a');
  await insertRound('APPLIED', 'art-a');

  const round = randomUUID();
  await pool.query(
    `INSERT INTO merchant_art_rounds (id, merchant_id, status, business_date) VALUES ($1, 'art-c', 'FAILED', '2026-09-29')`,
    [round],
  );
  const insertImage = (kind: string, idx: number) => pool.query(
    `INSERT INTO merchant_art_images (round_id, kind, idx, style, image, sha256) VALUES ($1, $2, $3, 'stamp', $4, $5)`,
    [round, kind, idx, Buffer.from('x'), 'a'.repeat(64)],
  );
  await assert.rejects(insertImage('PREVIEW', 0), /check/i);
  await assert.rejects(insertImage('DRAFT', 4), /check/i);
  await insertImage('DRAFT', 0);
  await assert.rejects(insertImage('DRAFT', 0), /duplicate key/i);
  await insertImage('FINAL', 0);
  await pool.query('DELETE FROM merchant_art_rounds WHERE id = $1', [round]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM merchant_art_images')).rows[0]!.n, 0);

  const insertArt = (merchantId: string, sha: string) => pool.query(
    'INSERT INTO merchant_art (merchant_id, image, sha256) VALUES ($1, $2, $3)', [merchantId, Buffer.from('x'), sha],
  );
  await insertArt('art-a', 'b'.repeat(64));
  await assert.rejects(insertArt('art-b', 'b'.repeat(64)), /duplicate key/i);
  await assert.rejects(insertArt('art-a', 'c'.repeat(64)), /duplicate key/i);
  await assert.rejects(pool.query(
    `INSERT INTO ai_art_spend (kind, micro_usd) VALUES ('DRAFT', -1)`,
  ), /check/i);
});

test('a round runs drafts, chosen final, apply, public image and reset end to end', async (t) => {
  const gate = makeGate();
  // 생성이 끝나기 전의 모습을 붙잡아 본다.
  const slow = await setup(t, { gate });
  const started = await slow.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  assert.equal(started.status, 'DRAFTING');
  assert.deepEqual(started.drafts, []);
  assert.equal(started.final, null);
  assert.equal(started.chosenIndex, null);
  assert.equal(started.failureCode, null);
  assert.equal((await slow.art.getState('art-a')).round?.status, 'DRAFTING');
  gate.release();
  await slow.art.drain();

  const ready = await slow.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(ready.status, 'DRAFTS_READY');
  assert.deepEqual(ready.drafts.map((draft) => [draft.index, draft.style, draft.label]),
    artStyles.map((style, index) => [index, style.key, style.label]));
  for (const draft of ready.drafts) assert.match(draft.imageDataUrl, /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/);
  assert.equal(new Set(ready.drafts.map((draft) => draft.imageDataUrl)).size, 4);
  assert.equal(ready.final, null);

  // 프롬프트에는 가게 이름과 메뉴 다섯 개까지만, user에는 가게 id의 해시만 간다. 계정 id는 어디에도 없다.
  assert.equal(slow.fake.calls.length, 4);
  const prompts = slow.fake.calls.map((call) => String(call.json!.prompt));
  assert.equal(new Set(prompts).size, 4);
  for (const call of slow.fake.calls) {
    assert.equal(call.path, '/v1/images/generations');
    assert.match(String(call.json!.prompt), /"고래 분식"/);
    assert.match(String(call.json!.prompt), /라면, 김밥, 우동, 돈까스, 떡볶이\./);
    assert.equal(String(call.json!.prompt).includes('순대'), false);
    assert.match(String(call.json!.user), /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(call.json).includes('staff-a'), false);
    assert.equal(JSON.stringify(call.json).includes('art-a'), false);
  }

  const state = await slow.art.getState('art-a');
  assert.equal(state.configured, true);
  assert.equal(state.current, null);
  assert.deepEqual(state.quota, { draftRoundsLeft: 2, finalsLeft: 3 });
  assert.equal(state.round?.id, started.id);

  const chosen = await slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 2 });
  assert.equal(chosen.status, 'FINALIZING');
  assert.equal(chosen.chosenIndex, 2);
  await slow.art.drain();
  const final = await slow.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(final.status, 'FINAL_READY');
  assert.match(final.final!.imageDataUrl, /^data:image\/webp;base64,/);
  assert.equal(slow.fake.calls.length, 5);
  const edit = slow.fake.calls[4]!;
  assert.equal(edit.path, '/v1/images/edits');
  const sent = edit.form!.get('image[]') as File;
  assert.deepEqual(Buffer.from(await sent.arrayBuffer()),
    Buffer.from(ready.drafts[2]!.imageDataUrl.split(',')[1]!, 'base64'));
  assert.equal(String(edit.form!.get('prompt')).includes('고래'), false);
  assert.equal(JSON.stringify([...edit.form!.entries()].filter(([, value]) => typeof value === 'string')).includes('staff-a'), false);
  assert.deepEqual((await slow.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 2 });

  // 적용 전에는 고객에게 보이지 않는다.
  const catalog = new PostgresMerchantCatalog(slow.pool, () => slow.now());
  assert.equal((await catalog.listPublicMerchants())[0]!.artUrl, null);
  const applied = await slow.art.apply({ merchantId: 'art-a', roundId: started.id });
  assert.match(applied.artUrl, /^\/merchant-art\/[0-9a-f]{64}\.webp$/);
  const sha = applied.artUrl.slice('/merchant-art/'.length, -'.webp'.length);
  const finalBytes = Buffer.from(final.final!.imageDataUrl.split(',')[1]!, 'base64');
  assert.deepEqual(await slow.art.getPublicImage(sha), finalBytes);
  assert.equal(await slow.art.getPublicImage('0'.repeat(64)), null);
  assert.equal((await catalog.listPublicMerchants())[0]!.artUrl, applied.artUrl);

  const after = await slow.art.getState('art-a');
  assert.deepEqual(after.current, { artUrl: applied.artUrl });
  assert.equal(after.round, null);
  // 응답이 유실돼 다시 눌러도 같은 결과이고, 되돌린 뒤에는 다시 적용할 수 없다.
  assert.deepEqual(await slow.art.apply({ merchantId: 'art-a', roundId: started.id }), applied);

  await slow.art.reset('art-a');
  assert.equal((await slow.art.getState('art-a')).current, null);
  assert.equal(await slow.art.getPublicImage(sha), null);
  assert.equal((await catalog.listPublicMerchants())[0]!.artUrl, null);
  await slow.art.reset('art-a');
  await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId: started.id }), rejectsWith('AI_ART_ROUND_STATE'));
});

test('every call is recorded with its real cost from the response usage', async (t) => {
  const db = await setup(t);
  await finalRound(db);
  assert.deepEqual(await spendRows(db.pool), [
    ...Array.from({ length: 4 }, () => ({ merchantId: 'art-a', kind: 'DRAFT', microUsd: fakeDraftCostMicroUsd })),
    { merchantId: 'art-a', kind: 'FINAL', microUsd: fakeFinalCostMicroUsd },
  ]);
});

test('only one round per merchant can be in progress, even under concurrent requests', async (t) => {
  const gate = makeGate();
  const slow = await setup(t, { gate });
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => slow.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' })),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of results) {
    if (result.status === 'rejected') assert.ok(rejectsWith('AI_ART_ROUND_IN_PROGRESS')(result.reason));
  }
  assert.equal((await slow.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 1);
  // 다른 가게는 막지 않는다.
  await slow.art.createRound({ merchantId: 'art-b', accountId: 'staff-b' });
  gate.release();
  await slow.art.drain();
  await slow.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await slow.art.drain();
});

test('choose and apply only work in their own state, once, and only for the owning merchant', async (t) => {
  const gate = makeGate();
  const slow = await setup(t, { gate });
  const started = await slow.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0 }),
    rejectsWith('AI_ART_ROUND_STATE'));
  await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId: started.id }), rejectsWith('AI_ART_ROUND_STATE'));
  gate.release();
  await slow.art.drain();

  // 동시에 두 번 고르면 하나만 최종을 시작한다.
  const picks = await Promise.allSettled([
    slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0 }),
    slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 3 }),
  ]);
  assert.equal(picks.filter((pick) => pick.status === 'fulfilled').length, 1);
  await slow.art.drain();
  assert.equal(slow.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 1);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 1 }),
    rejectsWith('AI_ART_ROUND_STATE'));
  assert.equal((await slow.pool.query(`SELECT count(*)::int AS n FROM ai_art_spend WHERE kind = 'FINAL'`)).rows[0]!.n, 1);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 4 }), RangeError);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: -1 }), RangeError);

  // 다른 가게의 라운드·없는 라운드·UUID가 아닌 값은 모두 같은 404다.
  for (const merchantId of ['art-b', 'art-c']) {
    await assert.rejects(slow.art.getRound({ merchantId, roundId: started.id }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
    await assert.rejects(slow.art.chooseDraft({ merchantId, roundId: started.id, index: 0 }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
    await assert.rejects(slow.art.apply({ merchantId, roundId: started.id }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
  }
  for (const roundId of [randomUUID(), 'not-a-uuid', '1; DROP TABLE merchants', '']) {
    await assert.rejects(slow.art.getRound({ merchantId: 'art-a', roundId }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
    await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
    await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId, index: 0 }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
  }
  // 다른 가게가 적용을 시도해도 가게 그림은 생기지 않는다.
  assert.equal((await slow.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 0);
});

test('draft rounds are limited per merchant and Korean day, with Retry-After to the next midnight', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 3; round++) await readyRound(db);
  // 한국 12:00이므로 다음 0시까지 12시간.
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }),
    rejectsWith('AI_ART_DAILY_LIMIT', 12 * 60 * 60));
  assert.equal(db.fake.calls.length, 12);
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 0, finalsLeft: 3 });
  // 다른 가게는 각자 한도를 쓴다.
  await readyRound(db, 'art-b', 'staff-b');

  // 한국 23:59:59까지는 같은 날, 0시가 지나면 새 날이다.
  db.state.now = new Date('2026-09-29T14:59:59.000Z');
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }), rejectsWith('AI_ART_DAILY_LIMIT', 1));
  db.state.now = new Date('2026-09-29T15:00:00.000Z');
  await readyRound(db);
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 3 });
});

test('finals are limited per merchant and Korean day, counted per attempt', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 5, dailyFinals: 2 } });
  await finalRound(db, 'art-a', 0);
  await finalRound(db, 'art-a', 1);
  const third = await readyRound(db);
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: third.id, index: 2 }),
    rejectsWith('AI_ART_DAILY_LIMIT', 12 * 60 * 60));
  // 거절된 선택은 라운드를 그대로 두고 호출도 기록도 남기지 않는다.
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: third.id })).status, 'DRAFTS_READY');
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ai_art_spend WHERE kind = 'FINAL'`)).rows[0]!.n, 2);
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 0 });

  db.state.now = new Date(db.state.now.getTime() + day);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: third.id, index: 2 });
  await db.art.drain();
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: third.id })).status, 'FINAL_READY');
});

test('the monthly budget refuses a request before any call and counts only this Korean month', async (t) => {
  // 예상 비용: 시안 라운드 40,000, 최종 120,000 마이크로 USD. 실제 시안 한 장은 8,760이다.
  const db = await setup(t, { config: { monthlyBudgetMicroUsd: 100_000, dailyDraftRounds: 9, dailyFinals: 9 } });
  await readyRound(db);
  await readyRound(db);
  assert.equal(await totalSpend(db.pool), 8 * fakeDraftCostMicroUsd);
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }),
    rejectsWith('AI_ART_BUDGET_EXHAUSTED'));
  // 거절은 호출도 라운드도 기록도 남기지 않는다.
  assert.equal(db.fake.calls.length, 8);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 2);
  assert.equal(await totalSpend(db.pool), 8 * fakeDraftCostMicroUsd);
  // 최종은 예상 비용(120,000)이 상한을 넘으므로 시안이 있어도 거절되고 라운드는 그대로다.
  const round = (await db.art.getState('art-a')).round!;
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0 }),
    rejectsWith('AI_ART_BUDGET_EXHAUSTED'));
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: round.id })).status, 'DRAFTS_READY');

  // 지난달(한국) 지출은 세지 않고, 이번 달 지출만 센다.
  const month = kstMonthRange(db.now());
  await db.pool.query('DELETE FROM ai_art_spend');
  await db.pool.query(
    `INSERT INTO ai_art_spend (kind, micro_usd, created_at) VALUES ('DRAFT', 99999999, $1)`,
    [new Date(month.start.getTime() - 1)],
  );
  await readyRound(db, 'art-b', 'staff-b');
  await db.pool.query(
    `INSERT INTO ai_art_spend (kind, micro_usd, created_at) VALUES ('DRAFT', 100000, $1)`, [month.start],
  );
  await assert.rejects(db.art.createRound({ merchantId: 'art-c', accountId: 'staff-c' }), rejectsWith('AI_ART_BUDGET_EXHAUSTED'));
  // 다음 달이 되면 다시 열린다.
  db.state.now = month.end;
  await readyRound(db, 'art-c', 'staff-c');
});

test('the budget check and record are serialized so concurrent requests cannot overspend', async (t) => {
  // 예상 비용 40,000짜리 요청이 정확히 두 번 들어갈 예산이다. 응답을 붙잡아 예상 비용 상태로 다섯 가게가 동시에 요청한다.
  const gate = makeGate();
  const db = await setup(t, { config: { monthlyBudgetMicroUsd: 80_000 }, gate });
  const results = await Promise.allSettled(
    ['art-a', 'art-b', 'art-c', 'art-d', 'art-e'].map((merchantId) =>
      db.art.createRound({ merchantId, accountId: 'someone' })),
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
  for (const result of results) {
    if (result.status === 'rejected') assert.ok(rejectsWith('AI_ART_BUDGET_EXHAUSTED')(result.reason));
  }
  const rows = await spendRows(db.pool);
  assert.equal(rows.length, 8);
  assert.equal(await totalSpend(db.pool), 80_000);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 2);
  gate.release();
  await db.art.drain();
});

test('a policy block fails the round without retry, drops partial drafts and refunds only the unmade images', async (t) => {
  let seen = 0;
  const db = await setup(t, {
    handler: (call) => call.path === '/v1/images/generations' && String(call.json!.prompt).includes('woodblock')
      ? (seen++, errorResponse(400, 'moderation_blocked')) : undefined,
  });
  const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'AI_ART_MODERATION_BLOCKED');
  assert.deepEqual(failed.drafts, []);
  assert.equal(seen, 1);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_images')).rows[0]!.n, 0);
  const rows = await spendRows(db.pool);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.microUsd).sort((a, b) => a - b),
    [0, fakeDraftCostMicroUsd, fakeDraftCostMicroUsd, fakeDraftCostMicroUsd]);
  // 실패한 라운드는 진행 중이 아니므로 바로 새 라운드를 만들 수 있고, 하루 횟수에는 센다.
  assert.equal((await db.art.getState('art-a')).round?.failureCode, 'AI_ART_MODERATION_BLOCKED');
  assert.equal((await db.art.getState('art-a')).quota.draftRoundsLeft, 2);
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0 }),
    rejectsWith('AI_ART_ROUND_STATE'));
});

test('spend-limit 429 and 5xx answers fail as unavailable and are retried at most once', async (t) => {
  const quota = await setup(t, { handler: () => errorResponse(429, 'credit_balance_exhausted') });
  const first = await quota.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await quota.art.drain();
  assert.equal((await quota.art.getRound({ merchantId: 'art-a', roundId: first.id })).failureCode, 'AI_ART_UPSTREAM_UNAVAILABLE');
  assert.equal(quota.fake.calls.length, 4);

  const flaky = await setup(t, { handler: () => errorResponse(503, null) });
  const second = await flaky.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await flaky.art.drain();
  assert.equal((await flaky.art.getRound({ merchantId: 'art-a', roundId: second.id })).failureCode, 'AI_ART_UPSTREAM_UNAVAILABLE');
  assert.equal(flaky.fake.calls.length, 8);
  assert.equal(await totalSpend(flaky.pool), 0);
});

test('a timeout fails the round as AI_ART_TIMEOUT and keeps the reserved cost because the outcome is unknown', async (t) => {
  const db = await setup(t, { fetch: hangingFetch, timeoutMs: 30 });
  const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'AI_ART_TIMEOUT');
  assert.equal(await totalSpend(db.pool), 40_000);
});

test('a failed final keeps the four drafts visible, marks FAILED and needs a new round', async (t) => {
  const db = await setup(t, {
    handler: (call) => call.path === '/v1/images/edits' ? errorResponse(400, 'moderation_blocked') : undefined,
  });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1 });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'AI_ART_MODERATION_BLOCKED');
  assert.equal(failed.drafts.length, 4);
  assert.equal(failed.chosenIndex, 1);
  assert.equal(failed.final, null);
  const finals = (await spendRows(db.pool)).filter((row) => row.kind === 'FINAL');
  assert.deepEqual(finals, [{ merchantId: 'art-a', kind: 'FINAL', microUsd: 0 }]);
  await assert.rejects(db.art.apply({ merchantId: 'art-a', roundId: round.id }), rejectsWith('AI_ART_ROUND_STATE'));
  await readyRound(db);
});

test('an unexpected error in the background job is written as FAILED and never crashes the process', async (t) => {
  const exploding: AiArtImageClient = {
    generateDraft: async () => { throw new Error('boom: something no one planned for'); },
    editFinal: async () => { throw new Error('boom'); },
  };
  const db = await setup(t, { client: exploding });
  const restore = console.error;
  const errors: unknown[] = [];
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
    await db.art.drain();
    const failed = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.failureCode, 'AI_ART_INTERRUPTED');
  } finally {
    console.error = restore;
  }
  // 오류 내용(메시지)은 로그에 남기지 않고 종류만 남긴다.
  assert.equal(JSON.stringify(errors).includes('something no one planned'), false);
});

test('a round not updated for five minutes turns into AI_ART_INTERRUPTED when read, freeing the merchant', async (t) => {
  const gate = makeGate();
  const db = await setup(t, { gate, heartbeatMs: 3_600_000 });
  const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  db.state.now = new Date(noon.getTime() + 4 * 60 * 1000);
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: started.id })).status, 'DRAFTING');
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_IN_PROGRESS'));
  db.state.now = new Date(noon.getTime() + 5 * 60 * 1000 + 1);
  const interrupted = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(interrupted.status, 'FAILED');
  assert.equal(interrupted.failureCode, 'AI_ART_INTERRUPTED');
  assert.equal((await db.art.getState('art-a')).round?.failureCode, 'AI_ART_INTERRUPTED');

  // 늦게 끝난 옛 작업이 이미 중단으로 적힌 라운드를 되살리지 못한다. 그 사이 새 라운드는 만들 수 있다.
  const second = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  gate.release();
  await db.art.drain();
  const still = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(still.status, 'FAILED');
  assert.equal(still.failureCode, 'AI_ART_INTERRUPTED');
  assert.deepEqual(still.drafts, []);
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: second.id })).status, 'DRAFTS_READY');

  // 진행 중인 작업은 주기적으로 updated_at을 갱신해 오래 걸려도 중단으로 오인되지 않는다.
  const gate2 = makeGate();
  const alive = await setup(t, { gate: gate2, heartbeatMs: 10 });
  const running = await alive.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  alive.state.now = new Date(noon.getTime() + 4 * 60 * 1000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  alive.state.now = new Date(noon.getTime() + 8 * 60 * 1000);
  assert.equal((await alive.art.getRound({ merchantId: 'art-a', roundId: running.id })).status, 'DRAFTING');
  gate2.release();
  await alive.art.drain();
});

test('creating a round removes only this merchant\'s unapplied rounds older than 30 days, with their images', async (t) => {
  const db = await setup(t);
  const old = new Date(noon.getTime() - 31 * day);
  const recent = new Date(noon.getTime() - 29 * day);
  const ids: Record<string, string> = {};
  for (const [name, merchantId, status, createdAt] of [
    ['oldFailed', 'art-a', 'FAILED', old], ['oldReady', 'art-a', 'DRAFTS_READY', old],
    ['oldApplied', 'art-a', 'APPLIED', old], ['recentReady', 'art-a', 'DRAFTS_READY', recent],
    ['otherMerchantOld', 'art-b', 'FAILED', old],
  ] as const) {
    ids[name] = randomUUID();
    await db.pool.query(
      `INSERT INTO merchant_art_rounds (id, merchant_id, status, business_date, created_at, updated_at)
       VALUES ($1, $2, $3, '2026-08-01', $4, $4)`,
      [ids[name], merchantId, status, createdAt],
    );
    await db.pool.query(
      `INSERT INTO merchant_art_images (round_id, kind, idx, style, image, sha256)
       VALUES ($1, 'DRAFT', 0, 'stamp', $2, $3)`,
      [ids[name], Buffer.from(name), 'd'.repeat(64)],
    );
  }
  await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const left = (await db.pool.query<{ id: string }>('SELECT id FROM merchant_art_rounds')).rows.map((row) => row.id);
  for (const name of ['oldApplied', 'recentReady', 'otherMerchantOld']) assert.ok(left.includes(ids[name]!), name);
  for (const name of ['oldFailed', 'oldReady']) assert.equal(left.includes(ids[name]!), false, name);
  const images = (await db.pool.query<{ round_id: string }>(
    `SELECT DISTINCT round_id FROM merchant_art_images WHERE kind = 'DRAFT' AND idx = 0 AND sha256 = $1`, ['d'.repeat(64)],
  )).rows.map((row) => row.round_id);
  assert.deepEqual(images.sort(), [ids.oldApplied, ids.recentReady, ids.otherMerchantOld].sort());
});

test('only the current applied image is public, and a new apply replaces the previous one', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 5, dailyFinals: 5 } });
  const first = await finalRound(db, 'art-a', 0);
  const appliedFirst = await db.art.apply({ merchantId: 'art-a', roundId: first.id });
  const shaFirst = appliedFirst.artUrl.slice('/merchant-art/'.length, -'.webp'.length);
  assert.ok(await db.art.getPublicImage(shaFirst));

  const second = await finalRound(db, 'art-a', 3);
  // 적용 전에는 첫 그림이 계속 공개이고, 새 그림은 아직 공개가 아니다.
  const secondSha = (await db.pool.query<{ sha256: string }>(
    `SELECT sha256 FROM merchant_art_images WHERE round_id = $1 AND kind = 'FINAL'`, [second.id],
  )).rows[0]!.sha256;
  assert.equal(await db.art.getPublicImage(secondSha), null);
  const appliedSecond = await db.art.apply({ merchantId: 'art-a', roundId: second.id });
  assert.equal(appliedSecond.artUrl, `/merchant-art/${secondSha}.webp`);
  assert.equal(await db.art.getPublicImage(shaFirst), null);
  assert.ok(await db.art.getPublicImage(secondSha));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 1);
  // 옛 라운드는 APPLIED로 남지만 다시 적용할 수는 없다.
  await assert.rejects(db.art.apply({ merchantId: 'art-a', roundId: first.id }), rejectsWith('AI_ART_ROUND_STATE'));
  // 다른 가게의 그림은 서로 섞이지 않는다.
  const other = await finalRound(db, 'art-b', 1);
  const appliedOther = await db.art.apply({ merchantId: 'art-b', roundId: other.id });
  assert.notEqual(appliedOther.artUrl, appliedSecond.artUrl);
  const listed = await new PostgresMerchantCatalog(db.pool, () => db.now()).listPublicMerchants();
  assert.deepEqual(listed.map((merchant) => [merchant.id, merchant.artUrl]), [['art-a', appliedSecond.artUrl]]);
});

test('the round view only carries its allow-listed fields and no account or merchant identifiers', async (t) => {
  const db = await setup(t);
  const round = await finalRound(db);
  assert.deepEqual(Object.keys(round).sort(),
    ['chosenIndex', 'createdAt', 'drafts', 'failureCode', 'final', 'id', 'status']);
  assert.deepEqual(Object.keys(round.drafts[0]!).sort(), ['imageDataUrl', 'index', 'label', 'style']);
  assert.deepEqual(Object.keys(round.final!), ['imageDataUrl']);
  const serialized = JSON.stringify(await db.art.getState('art-a'));
  for (const secret of ['staff-a', 'owner-a', 'requested_by', 'art-a']) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test('without a key the service reports configured false, refuses generation and still serves reads and reset', async (t) => {
  const db = await setup(t, { client: 'none' });
  const state = await db.art.getState('art-a');
  assert.deepEqual(state, {
    configured: false, current: null, quota: { draftRoundsLeft: 3, finalsLeft: 3 }, round: null,
  });
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }), rejectsWith('AI_ART_NOT_CONFIGURED'));
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: randomUUID(), index: 0 }), rejectsWith('AI_ART_NOT_CONFIGURED'));
  await db.art.reset('art-a');
  assert.equal(await db.art.getPublicImage('0'.repeat(64)), null);
  assert.equal(db.fake.calls.length, 0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 0);
});

test('MANAGE_ART is granted to active owners and staff of the merchant only', async (t) => {
  const { pool } = await setup(t);
  const access = new PostgresMerchantAccessControl(pool);
  for (const accountId of ['owner-a', 'staff-a']) {
    const grant = await access.requirePermission({ accountId, merchantId: 'art-a', permission: 'MANAGE_ART' });
    assert.equal(grant.merchantId, 'art-a');
    // 응답에 실리는 권한 목록은 예전 앱 파서와 같은 두 값 그대로다.
    assert.deepEqual(grant.permissions, ['VIEW_MERCHANT', 'CONFIRM_VISIT']);
  }
  for (const [accountId, merchantId] of [
    ['gone-a', 'art-a'], ['staff-b', 'art-a'], ['owner-a', 'art-b'], ['nobody', 'art-a'], ['staff-a', 'no-such-merchant'],
  ] as const) {
    await assert.rejects(access.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' }),
      MerchantAccessError, `${accountId}@${merchantId}`);
  }
  await assert.rejects(access.requirePermission({
    accountId: 'staff-a', merchantId: 'art-a', permission: 'MANAGE_EVERYTHING' as never,
  }), MerchantAccessError);
});

test('account deletion clears the requester of art rounds in the same transaction and keeps the merchant assets', async (t) => {
  const db = await setup(t, { lifecycle: true });
  const round = await finalRound(db, 'art-a', 1);
  await db.art.apply({ merchantId: 'art-a', roundId: round.id });
  await db.art.createRound({ merchantId: 'art-b', accountId: 'staff-b' });
  await db.art.drain();
  await db.art.createRound({ merchantId: 'art-a', accountId: 'owner-a' });
  await db.art.drain();
  const requesters = async () => (await db.pool.query<{ requested_by_account_id: string | null }>(
    'SELECT requested_by_account_id FROM merchant_art_rounds ORDER BY created_at, id',
  )).rows.map((row) => row.requested_by_account_id);
  assert.deepEqual((await requesters()).sort(), ['owner-a', 'staff-a', 'staff-b']);

  const deletion = new PostgresAccountDeletionService(db.pool, {
    hmacSecret, policyVersion: 'account-deletion-v1', accountLifecycle: db.lifecycle,
  });
  await deletion.requestDeletion({ accountId: 'staff-a', confirmation: 'DELETE MY ACCOUNT' });
  const after = await requesters();
  assert.equal(after.includes('staff-a'), false);
  assert.equal(after.filter((requester) => requester === null).length, 1);
  assert.deepEqual(after.filter((requester) => requester !== null).sort(), ['owner-a', 'staff-b']);
  // 가게 그림과 라운드·비용 기록은 그대로다.
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 1);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 3);
  assert.equal((await spendRows(db.pool)).length, 13);
  assert.equal((await db.art.getState('art-a')).current !== null, true);
  // 삭제된 계정이 라운드를 만들려 하면 거절되고, 계정 ID는 다시 저장되지 않는다.
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }), rejectsWith('ACCOUNT_DELETED'));
  assert.equal((await requesters()).includes('staff-a'), false);
});

// ---- HTTP: 실제 서버 경로 + PostgreSQL ------------------------------------------------------------

test('HTTP flow: owner routes, permission, binary public image and public merchant art URL', async (t) => {
  const db = await setup(t);
  const server = createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 5 * 60 * 1000,
    }),
    developmentHeaderAccountResolver,
    new PostgresMerchantCatalog(db.pool, () => db.now()),
    new PostgresMerchantAccessControl(db.pool),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined,
    db.art,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  const call = (method: string, path: string, account: string | null, body?: unknown) => fetch(`${base}${path}`, {
    method,
    headers: { ...(account ? { 'x-account-id': account } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const art = '/merchant/merchants/art-a/art';

  // 인증·권한: 로그인 없음 401, 다른 가게 직원·철회된 직원·무소속 403. 생성 호출도 기록도 없다.
  assert.equal((await call('GET', art, null)).status, 401);
  for (const account of ['staff-b', 'gone-a', 'nobody']) {
    for (const [method, path, body] of [
      ['GET', art], ['POST', `${art}/rounds`, {}], ['DELETE', art], ['GET', `${art}/rounds/${randomUUID()}`],
      ['POST', `${art}/rounds/${randomUUID()}/choose`, { index: 0 }], ['POST', `${art}/rounds/${randomUUID()}/apply`, {}],
    ] as const) {
      const response = await call(method, path, account, body);
      assert.equal(response.status, 403, `${account} ${method} ${path}`);
      assert.deepEqual(await response.json(), { code: 'MERCHANT_ACCESS_DENIED' });
    }
  }
  assert.equal(db.fake.calls.length, 0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 0);

  const initial = await call('GET', art, 'owner-a');
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await initial.json(), {
    configured: true, current: null, quota: { draftRoundsLeft: 3, finalsLeft: 3 }, round: null,
  });

  const created = await call('POST', `${art}/rounds`, 'staff-a', {});
  assert.equal(created.status, 202);
  const round = await created.json() as ArtRoundView;
  assert.equal(round.status, 'DRAFTING');
  await db.art.drain();
  const polled = await call('GET', `${art}/rounds/${round.id}`, 'staff-a');
  assert.equal(polled.status, 200);
  assert.equal(((await polled.json()) as ArtRoundView).status, 'DRAFTS_READY');
  // 다른 가게 직원은 이 라운드를 못 본다(그 가게의 권한이 없으므로 403).
  assert.equal((await call('GET', `/merchant/merchants/art-b/art/rounds/${round.id}`, 'staff-b')).status, 404);

  const choose = await call('POST', `${art}/rounds/${round.id}/choose`, 'staff-a', { index: 0 });
  assert.equal(choose.status, 202);
  assert.equal(((await choose.json()) as ArtRoundView).status, 'FINALIZING');
  assert.equal((await call('POST', `${art}/rounds/${round.id}/choose`, 'staff-a', { index: 0 })).status, 409);
  await db.art.drain();
  const applied = await call('POST', `${art}/rounds/${round.id}/apply`, 'staff-a', {});
  assert.equal(applied.status, 200);
  const { artUrl } = await applied.json() as { artUrl: string };
  assert.match(artUrl, /^\/merchant-art\/[0-9a-f]{64}\.webp$/);

  // 공개 그림: 로그인 없이, 이진 image/webp, 오래 캐시.
  const image = await fetch(`${base}${artUrl}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  assert.deepEqual(bytes, await db.art.getPublicImage(artUrl.slice('/merchant-art/'.length, -'.webp'.length)));
  // 형식이 다르거나 없는 그림은 JSON 404이고 캐시되지 않는다.
  for (const path of [
    `/merchant-art/${'0'.repeat(64)}.webp`, `/merchant-art/${'A'.repeat(64)}.webp`, `/merchant-art/${'0'.repeat(63)}.webp`,
    `/merchant-art/${'0'.repeat(64)}.png`, '/merchant-art/abc.webp', '/merchant-art/',
  ]) {
    const missing = await fetch(`${base}${path}`);
    assert.equal(missing.status, 404, path);
    assert.equal(missing.headers.get('cache-control'), 'no-store', path);
    assert.match(missing.headers.get('content-type') ?? '', /^application\/json/, path);
  }
  assert.equal((await fetch(`${base}${artUrl}`, { method: 'POST' })).status, 404);

  // 고객 목록에 상대 경로가 실린다.
  const listed = await (await fetch(`${base}/merchants`)).json() as { merchants: { id: string; artUrl: string | null }[] };
  assert.deepEqual(listed.merchants.map((merchant) => [merchant.id, merchant.artUrl]), [['art-a', artUrl]]);
  const state = await (await call('GET', art, 'owner-a')).json() as { current: unknown; round: unknown };
  assert.deepEqual(state.current, { artUrl });
  assert.equal(state.round, null);

  const reset = await call('DELETE', art, 'owner-a');
  assert.equal(reset.status, 200);
  assert.deepEqual(await reset.json(), { status: 'RESET' });
  assert.equal((await fetch(`${base}${artUrl}`)).status, 404);

  // 입력 검증과 알 수 없는 경로.
  assert.equal((await call('POST', `${art}/rounds`, 'staff-a', { free: 'text' })).status, 400);
  const badIndex = [{ index: 4 }, { index: -1 }, { index: 1.5 }, { index: '1' }, {}, { index: 1, extra: 1 }];
  for (const body of badIndex) {
    assert.equal((await call('POST', `${art}/rounds/${round.id}/choose`, 'staff-a', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('POST', `${art}/rounds/not-a-uuid/apply`, 'staff-a', {})).status, 404);
  assert.equal((await call('GET', `${art}/rounds/%E0%A4%A`, 'staff-a')).status, 400);
  for (const [method, path] of [
    ['PUT', art], ['GET', `${art}/rounds`], ['DELETE', `${art}/rounds/${round.id}`],
    ['GET', `${art}/rounds/${round.id}/apply`], ['GET', `${art}/extra`], ['POST', `${art}/rounds/${round.id}/other`],
  ] as const) {
    assert.equal((await call(method, path, 'staff-a', method === 'GET' ? undefined : {})).status, 404, `${method} ${path}`);
  }
});

test('HTTP: daily limit answers 429 with Retry-After and a missing key answers 503 while reads keep working', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 1 } });
  const build = (art: PostgresMerchantArtService) => createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 5 * 60 * 1000,
    }),
    developmentHeaderAccountResolver, undefined, new PostgresMerchantAccessControl(db.pool),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, art,
  );
  const listen = async (server: ReturnType<typeof build>) => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  };
  const base = await listen(build(db.art));
  const headers = { 'x-account-id': 'staff-a', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/merchant/merchants/art-a/art/rounds`, { method: 'POST', headers, body: '{}' })).status, 202);
  await db.art.drain();
  const limited = await fetch(`${base}/merchant/merchants/art-a/art/rounds`, { method: 'POST', headers, body: '{}' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), String(12 * 60 * 60));
  assert.deepEqual(await limited.json(), { code: 'AI_ART_DAILY_LIMIT' });

  const keyless = await setup(t, { client: 'none' });
  const keylessBase = await listen(build(keyless.art));
  const state = await fetch(`${keylessBase}/merchant/merchants/art-a/art`, { headers });
  assert.equal(state.status, 200);
  assert.equal(((await state.json()) as { configured: boolean }).configured, false);
  const refused = await fetch(`${keylessBase}/merchant/merchants/art-a/art/rounds`, { method: 'POST', headers, body: '{}' });
  assert.equal(refused.status, 503);
  assert.deepEqual(await refused.json(), { code: 'AI_ART_NOT_CONFIGURED' });
});
