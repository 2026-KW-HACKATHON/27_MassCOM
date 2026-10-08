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
  fakeWebp,
  hangingFetch,
  imageResponse,
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
import { PostgresStaffRegistration } from './postgres/staff-registration.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
const merchantIds = ['art-a', 'art-b', 'art-c', 'art-d', 'art-e', 'art-f'] as const;
// 가게마다 활성 STAFF가 한 명씩 있다(art-a의 staff-a, art-b의 staff-b, art-c의 staff-c ...). 그림 변경은 트랜잭션 안에서 멤버십을 다시 본다.
const staffOf = (merchantId: string) => `staff-${merchantId.slice('art-'.length)}`;
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
  // true이면 문은 최종(edits) 호출만 붙잡는다.
  gateEditsOnly?: boolean;
  config?: Partial<Pick<AiArtConfig, 'monthlyBudgetMicroUsd' | 'dailyDraftRounds' | 'dailyFinals'>>;
  handler?: FakeOpenAiHandler;
  fetch?: typeof fetch;
  timeoutMs?: number;
  staleAfterMs?: number;
  heartbeatMs?: number;
  client?: AiArtImageClient | 'none';
  minGenerationIntervalMs?: number;
  lifecycle?: boolean;
  // 기본 true(시연 설정): 시험 대부분이 STAFF로 그림을 만든다. false이면 활성 OWNER만 그림을 바꿀 수 있다.
  staffMayManageArt?: boolean;
  // 서비스가 쓰는 pool을 바꿔 끼운다(특정 읽기를 실패시키는 시험용). 시험 설정 자체는 진짜 pool을 쓴다.
  wrapPool?: (pool: Pool) => Pool;
  // 시험이 직접 만든 문. gate처럼 시험이 끝나거나 실패할 때 반드시 연다(안 그러면 붙잡힌 작업 때문에 정리가 끝나지 않는다).
  releaseOnCleanup?: readonly Gate[];
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
       ('art-b', 'staff-b', 'STAFF', 'ACTIVE', NULL),
       ('art-c', 'staff-c', 'STAFF', 'ACTIVE', NULL),
       ('art-d', 'staff-d', 'STAFF', 'ACTIVE', NULL),
       ('art-e', 'staff-e', 'STAFF', 'ACTIVE', NULL),
       ('art-f', 'staff-f', 'STAFF', 'ACTIVE', NULL)`,
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
    ? async (call, index) => {
      if (!options.gateEditsOnly || call.path === '/v1/images/edits') await options.gate!.opened;
      return options.handler?.(call, index);
    }
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
  const art = new PostgresMerchantArtService(options.wrapPool ? options.wrapPool(pool) : pool, {
    ...(client ? { client } : {}),
    config: { ...defaults, ...options.config },
    ...(options.lifecycle ? { accountLifecycle: lifecycle } : {}),
    staffMayManageArt: options.staffMayManageArt ?? true,
    minGenerationIntervalMs: options.minGenerationIntervalMs ?? 0,
    ...(options.config?.dailyDraftRounds !== undefined ? { accountDailyDraftRounds: options.config.dailyDraftRounds } : {}),
    ...(options.config?.dailyFinals !== undefined ? { accountDailyFinals: options.config.dailyFinals } : {}),
    now,
    ...(options.staleAfterMs !== undefined ? { staleAfterMs: options.staleAfterMs } : {}),
    ...(options.heartbeatMs !== undefined ? { heartbeatMs: options.heartbeatMs } : {}),
  });
  t.after(async () => {
    options.gate?.release();
    for (const extra of options.releaseOnCleanup ?? []) extra.release();
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

// 라운드 한 개를 읽는 조회(requireView)를 arm된 동안 한 번 실패시키는 pool. 다른 질의는 그대로 지나간다.
function failingRoundViewOnce(state: { armed: boolean }): (pool: Pool) => Pool {
  return (pool) => new Proxy(pool, {
    get(target, property) {
      if (property === 'query') {
        return (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : '';
          if (state.armed && sql.includes('FROM merchant_art_rounds WHERE id = $1 AND merchant_id = $2') && !sql.includes('FOR UPDATE')) {
            state.armed = false;
            return Promise.reject(new Error('view read failed'));
          }
          return (target.query as (...forwarded: unknown[]) => unknown)(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function readyRound(db: Db, merchantId = 'art-a', accountId = staffOf(merchantId)): Promise<ArtRoundView> {
  const started = await db.art.createRound({ merchantId, accountId });
  await db.art.drain();
  const round = await db.art.getRound({ merchantId, roundId: started.id });
  assert.equal(round.status, 'DRAFTS_READY');
  return round;
}

async function finalRound(db: Db, merchantId = 'art-a', index = 1, accountId = staffOf(merchantId)): Promise<ArtRoundView> {
  const round = await readyRound(db, merchantId, accountId);
  await db.art.chooseDraft({ merchantId, roundId: round.id, index, accountId });
  await db.art.drain();
  const final = await db.art.getRound({ merchantId, roundId: round.id });
  assert.equal(final.status, 'FINAL_READY');
  return final;
}

// 조건이 참이 될 때까지 짧게 기다린다(백그라운드 작업이 특정 쓰기를 마쳤는지 볼 때). 5초가 지나면 실패한다.
async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let waited = 0; waited < 5_000; waited += 10) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// 서비스가 라운드 상태를 적는 쓰기(완료·실패 기록)를 마칠 때마다 done에 이름을 남기는 pool. 쓰기는 그대로 지나간다.
function watchingStateWrites(done: string[]): (pool: Pool) => Pool {
  return (pool) => new Proxy(pool, {
    get(target, property) {
      if (property === 'query') {
        return async (...args: unknown[]) => {
          const result: unknown = await (target.query as (...forwarded: unknown[]) => Promise<unknown>).apply(target, args);
          const sql = typeof args[0] === 'string' ? args[0] : '';
          if (sql.includes(`SET status = 'FINAL_READY'`)) done.push('FINAL_READY');
          if (sql.includes(`SET status = 'FAILED', failure_code = $2`)) done.push('FAILED');
          return result;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const finalImages = async (pool: Pool, roundId: string) =>
  (await pool.query<{ idx: number; sha256: string }>(
    `SELECT idx, sha256 FROM merchant_art_images WHERE round_id = $1 AND kind = 'FINAL' ORDER BY idx`, [roundId],
  )).rows;

const roundRow = async (pool: Pool, roundId: string) =>
  (await pool.query<{ status: string; chosen_index: number | null; failure_code: string | null; final_spend_id: string | null }>(
    'SELECT status, chosen_index, failure_code, final_spend_id::text FROM merchant_art_rounds WHERE id = $1', [roundId],
  )).rows[0]!;

// 최종 단계 시도 1이 OpenAI 응답을 붙잡힌 채 5분이 지나 중단으로 적히고, 같은 라운드에서 다른 시안을 다시 골라 시도 2가 시작된
// 상태를 만든다. 시도 1의 응답은 first 문을 열면 나가고(firstOutcome), 시도 2는 holdSecond일 때 second 문을 열 때까지 붙잡힌다.
async function rechosenAfterStale(t: TestContext, options: { firstOutcome: 'success' | 'failure'; holdSecond: boolean }) {
  const first = makeGate();
  const second = makeGate();
  const done: string[] = [];
  let edits = 0;
  const db = await setup(t, {
    heartbeatMs: 3_600_000,
    releaseOnCleanup: [first, second],
    wrapPool: watchingStateWrites(done),
    handler: async (call) => {
      if (call.path !== '/v1/images/edits') return undefined;
      const attempt = edits++;
      if (attempt === 0) {
        await first.opened;
        return options.firstOutcome === 'failure' ? errorResponse(400, 'moderation_blocked') : undefined;
      }
      if (options.holdSecond) await second.opened;
      return undefined;
    },
  });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' });
  await waitFor(() => edits === 1, 'the first final attempt to reach OpenAI');
  db.state.now = new Date(noon.getTime() + 5 * 60 * 1000 + 1);
  const interrupted = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(interrupted.status, 'FAILED');
  assert.equal(interrupted.failureCode, 'AI_ART_INTERRUPTED');
  assert.equal(interrupted.chosenIndex, 1);

  const again = await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 3, accountId: 'staff-a' });
  assert.equal(again.status, 'FINALIZING');
  assert.equal(again.chosenIndex, 3);
  const spendIds = (await db.pool.query<{ id: string }>(
    `SELECT id::text FROM ai_art_spend WHERE kind = 'FINAL' ORDER BY id`,
  )).rows.map((row) => row.id);
  assert.equal(spendIds.length, 2);
  // 라운드는 가장 최근 시도(시도 2)의 표지를 가진다.
  assert.equal((await roundRow(db.pool, round.id)).final_spend_id, spendIds[1]);
  return { db, round, first, second, done, spendIds, editCalls: () => edits };
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
  assert.equal((await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'merchant_art_rounds' AND column_name = 'final_spend_id' AND data_type = 'bigint'`,
  )).rowCount, 1);

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
  // sha256은 유일하지 않다: 다른 가게가 같은 그림 바이트를 적용해도 실패하지 않는다. 가게당 한 장(PK)은 그대로다.
  await insertArt('art-b', 'b'.repeat(64));
  await assert.rejects(insertArt('art-a', 'c'.repeat(64)), /duplicate key/i);
  const shaIndex = await pool.query<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'merchant_art' AND indexname = 'merchant_art_sha256_idx'`,
  );
  assert.equal(shaIndex.rowCount, 1);
  assert.equal(/unique/i.test(shaIndex.rows[0]!.indexdef), false);
  assert.equal((await pool.query(
    `SELECT 1 FROM pg_indexes WHERE tablename = 'merchant_art' AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%sha256%'`,
  )).rowCount, 0);
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
    assert.match(String(call.json!.prompt), /"라면", "김밥", "우동", "돈까스", "떡볶이"\./);
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

  const chosen = await slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 2, accountId: 'staff-a' });
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
  const applied = await slow.art.apply({ merchantId: 'art-a', roundId: started.id, accountId: 'staff-a' });
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
  assert.deepEqual(await slow.art.apply({ merchantId: 'art-a', roundId: started.id, accountId: 'staff-a' }), applied);

  await slow.art.reset({ merchantId: 'art-a', accountId: 'staff-a' });
  assert.equal((await slow.art.getState('art-a')).current, null);
  assert.equal(await slow.art.getPublicImage(sha), null);
  assert.equal((await catalog.listPublicMerchants())[0]!.artUrl, null);
  await slow.art.reset({ merchantId: 'art-a', accountId: 'staff-a' });
  await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId: started.id, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
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
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0, accountId: 'staff-a' }),
    rejectsWith('AI_ART_ROUND_STATE'));
  await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId: started.id, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
  gate.release();
  await slow.art.drain();

  // 동시에 두 번 고르면 하나만 최종을 시작한다.
  const picks = await Promise.allSettled([
    slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0, accountId: 'staff-a' }),
    slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 3, accountId: 'staff-a' }),
  ]);
  assert.equal(picks.filter((pick) => pick.status === 'fulfilled').length, 1);
  await slow.art.drain();
  assert.equal(slow.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 1);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 1, accountId: 'staff-a' }),
    rejectsWith('AI_ART_ROUND_STATE'));
  assert.equal((await slow.pool.query(`SELECT count(*)::int AS n FROM ai_art_spend WHERE kind = 'FINAL'`)).rows[0]!.n, 1);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 4, accountId: 'staff-a' }), RangeError);
  await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: -1, accountId: 'staff-a' }), RangeError);

  // 다른 가게의 라운드·없는 라운드·UUID가 아닌 값은 모두 같은 404다.
  for (const merchantId of ['art-b', 'art-c']) {
    await assert.rejects(slow.art.getRound({ merchantId, roundId: started.id }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
    await assert.rejects(slow.art.chooseDraft({ merchantId, roundId: started.id, index: 0, accountId: staffOf(merchantId) }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
    await assert.rejects(slow.art.apply({ merchantId, roundId: started.id, accountId: staffOf(merchantId) }), rejectsWith('AI_ART_ROUND_NOT_FOUND'));
  }
  for (const roundId of [randomUUID(), 'not-a-uuid', '1; DROP TABLE merchants', '']) {
    await assert.rejects(slow.art.getRound({ merchantId: 'art-a', roundId }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
    await assert.rejects(slow.art.apply({ merchantId: 'art-a', roundId, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
    await assert.rejects(slow.art.chooseDraft({ merchantId: 'art-a', roundId, index: 0, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_NOT_FOUND'), roundId);
  }
  // 다른 가게가 적용을 시도해도 가게 그림은 생기지 않는다.
  assert.equal((await slow.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 0);
});

test('the state shows a round in progress first and nothing when the newest round is already applied', async (t) => {
  const held = makeGate();
  const db = await setup(t, { gate: held, gateEditsOnly: true });
  const older = await readyRound(db);
  // 시계가 같은 값이면 "더 새로운" 라운드를 가릴 수 없으므로 시각을 앞으로 보낸다.
  db.state.now = new Date(db.state.now.getTime() + 60_000);
  const newer = await readyRound(db);
  assert.equal((await db.art.getState('art-a')).round?.id, newer.id);

  // 더 오래된 라운드에서 최종을 시작하면(호출은 붙잡혀 있다) 더 새로운 라운드보다 진행 중인 그 라운드가 먼저 보인다.
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: older.id, index: 2, accountId: 'staff-a' });
  const shown = (await db.art.getState('art-a')).round;
  assert.equal(shown?.id, older.id);
  assert.equal(shown?.status, 'FINALIZING');
  held.release();
  await db.art.drain();

  // 진행 중인 것이 없고 가장 최근 라운드가 이미 적용됐으면 보여 줄 것이 없다(더 오래된 미적용 라운드는 되살리지 않는다).
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: newer.id, index: 0, accountId: 'staff-a' });
  await db.art.drain();
  await db.art.apply({ merchantId: 'art-a', roundId: newer.id, accountId: 'staff-a' });
  const state = await db.art.getState('art-a');
  assert.equal(state.round, null);
  assert.notEqual(state.current, null);
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

test('one account cannot bypass the generation cooldown or daily draft quota by switching merchants', async (t) => {
  const db = await setup(t, { minGenerationIntervalMs: 60_000 });
  await db.pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('art-a', 'multi', 'STAFF', 'ACTIVE'), ('art-b', 'multi', 'STAFF', 'ACTIVE')`);
  await readyRound(db, 'art-a', 'multi');
  const before = await spendRows(db.pool);
  assert.deepEqual((await db.art.getState('art-b', 'multi')).quota.account, {
    draftRoundsLeft: 2, finalsLeft: 3,
    resetsAt: '2026-09-29T15:00:00.000Z', cooldownUntil: '2026-09-29T03:01:00.000Z',
  });
  await assert.rejects(db.art.createRound({ merchantId: 'art-b', accountId: 'multi' }),
    rejectsWith('AI_ART_COOLDOWN', 60));
  assert.deepEqual(await spendRows(db.pool), before);
  db.state.now = new Date(db.now().getTime() + 60_000);
  await readyRound(db, 'art-b', 'multi');
  db.state.now = new Date(db.now().getTime() + 60_000);
  await readyRound(db, 'art-a', 'multi');
  db.state.now = new Date(db.now().getTime() + 60_000);
  await assert.rejects(db.art.createRound({ merchantId: 'art-b', accountId: 'multi' }),
    rejectsWith('AI_ART_ACCOUNT_DAILY_LIMIT', 12 * 60 * 60 - 180));
  assert.equal((await spendRows(db.pool)).length, 12);
  assert.equal(db.fake.calls.length, 12);
});

test('simultaneous draft requests for two merchants consume only one account generation slot', async (t) => {
  const db = await setup(t, { minGenerationIntervalMs: 60_000 });
  await db.pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('art-a', 'multi', 'STAFF', 'ACTIVE'), ('art-b', 'multi', 'STAFF', 'ACTIVE')`);
  const results = await Promise.allSettled([
    db.art.createRound({ merchantId: 'art-a', accountId: 'multi' }),
    db.art.createRound({ merchantId: 'art-b', accountId: 'multi' }),
  ]);
  await db.art.drain();
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && rejectsWith('AI_ART_COOLDOWN', 60)(result.reason)).length, 1);
  assert.equal((await spendRows(db.pool)).length, 4);
  assert.equal(db.fake.calls.length, 4);
});

test('a draft waiting on the budget lock uses the new KST day and elapsed cooldown at reservation', async (t) => {
  const db = await setup(t, { minGenerationIntervalMs: 60_000 });
  await db.pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('art-a', 'multi', 'STAFF', 'ACTIVE'), ('art-b', 'multi', 'STAFF', 'ACTIVE')`);
  db.state.now = new Date('2026-09-29T14:59:30.000Z');
  await readyRound(db, 'art-a', 'multi');
  db.state.now = new Date('2026-09-29T14:59:59.000Z');

  const holder = await db.pool.connect();
  let pending: Promise<ArtRoundView | unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('ai-art-budget', 0))");
    pending = db.art.createRound({ merchantId: 'art-b', accountId: 'multi' }).then(value => value, error => error);
    await waitFor(async () => (await lockWaits(db.pool)) === 1, 'draft to wait on the budget lock');
    db.state.now = new Date('2026-09-29T15:00:30.000Z');
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
  const result = await pending;
  assert.ok(result && !(result instanceof Error));
  await db.art.drain();
  const round = result as ArtRoundView;
  const reservation = (await db.pool.query<{ business_date: string; created_at: Date }>(
    `SELECT business_date::text, created_at FROM merchant_art_rounds WHERE id = $1`, [round.id],
  )).rows[0]!;
  assert.equal(reservation.business_date, '2026-09-30');
  assert.equal(reservation.created_at.toISOString(), '2026-09-29T15:00:30.000Z');
  assert.deepEqual((await db.art.getState('art-b', 'multi')).quota.account, {
    draftRoundsLeft: 2, finalsLeft: 3, resetsAt: '2026-09-30T15:00:00.000Z',
    cooldownUntil: '2026-09-29T15:01:30.000Z',
  });
});

test('a final waiting on the budget lock records the post-wait day and spend time', async (t) => {
  const db = await setup(t, { minGenerationIntervalMs: 60_000 });
  db.state.now = new Date('2026-09-29T14:59:59.000Z');
  const round = await readyRound(db, 'art-a', 'staff-a');
  const holder = await db.pool.connect();
  let pending: Promise<ArtRoundView | unknown> | undefined;
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('ai-art-budget', 0))");
    pending = db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0, accountId: 'owner-a' })
      .then(value => value, error => error);
    await waitFor(async () => (await lockWaits(db.pool)) === 1, 'final to wait on the budget lock');
    db.state.now = new Date('2026-09-29T15:00:01.000Z');
    await holder.query('COMMIT');
  } finally {
    await holder.query('ROLLBACK').catch(() => undefined);
    holder.release();
  }
  const result = await pending;
  assert.ok(result && !(result instanceof Error));
  await db.art.drain();
  const reservation = (await db.pool.query<{ created_at: Date }>(
    `SELECT created_at FROM ai_art_spend WHERE round_id = $1 AND kind = 'FINAL'`, [round.id],
  )).rows[0]!;
  assert.equal(reservation.created_at.toISOString(), '2026-09-29T15:00:01.000Z');
  assert.deepEqual((await db.art.getState('art-a', 'owner-a')).quota.account, {
    draftRoundsLeft: 3, finalsLeft: 2, resetsAt: '2026-09-30T15:00:00.000Z',
    cooldownUntil: '2026-09-29T15:01:01.000Z',
  });
});

test('final generation is limited by the choosing account across merchants', async (t) => {
  const db = await setup(t, { minGenerationIntervalMs: 60_000 });
  await db.pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('art-a', 'multi', 'STAFF', 'ACTIVE'), ('art-b', 'multi', 'STAFF', 'ACTIVE'),
           ('art-c', 'multi', 'STAFF', 'ACTIVE'), ('art-d', 'multi', 'STAFF', 'ACTIVE')`);
  const rounds = [];
  for (const merchantId of ['art-a', 'art-b', 'art-c', 'art-d']) rounds.push(await readyRound(db, merchantId));
  for (let index = 0; index < 3; index += 1) {
    db.state.now = new Date(db.now().getTime() + 60_000);
    await db.art.chooseDraft({ merchantId: `art-${'abcd'[index]}`, roundId: rounds[index]!.id, index: 0, accountId: 'multi' });
    await db.art.drain();
  }
  db.state.now = new Date(db.now().getTime() + 60_000);
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-d', roundId: rounds[3]!.id, index: 0, accountId: 'multi' }),
    rejectsWith('AI_ART_ACCOUNT_DAILY_LIMIT', 12 * 60 * 60 - 240));
  assert.equal((await db.art.getRound({ merchantId: 'art-d', roundId: rounds[3]!.id })).status, 'DRAFTS_READY');
  assert.equal((await spendRows(db.pool)).filter(row => row.kind === 'FINAL').length, 3);
});

test('finals are limited per merchant and Korean day, counted per attempt', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 5, dailyFinals: 2 } });
  await finalRound(db, 'art-a', 0);
  await finalRound(db, 'art-a', 1);
  const third = await readyRound(db);
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: third.id, index: 2, accountId: 'staff-a' }),
    rejectsWith('AI_ART_DAILY_LIMIT', 12 * 60 * 60));
  // 거절된 선택은 라운드를 그대로 두고 호출도 기록도 남기지 않는다.
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: third.id })).status, 'DRAFTS_READY');
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ai_art_spend WHERE kind = 'FINAL'`)).rows[0]!.n, 2);
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 0 });

  db.state.now = new Date(db.state.now.getTime() + day);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: third.id, index: 2, accountId: 'staff-a' });
  await db.art.drain();
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: third.id })).status, 'FINAL_READY');
});

test('the monthly budget refuses a request before any call and counts only this Korean month', async (t) => {
  // 예상 비용: 시안 라운드 40,000, 최종 180,000 마이크로 USD. 실제 시안 한 장은 8,760이다.
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
  // 최종은 예상 비용(180,000)이 상한을 넘으므로 시안이 있어도 거절되고 라운드는 그대로다.
  const round = (await db.art.getState('art-a')).round!;
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0, accountId: 'staff-a' }),
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
      db.art.createRound({ merchantId, accountId: staffOf(merchantId) })),
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
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0, accountId: 'staff-a' }),
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

test('a network failure is not retried, fails as unavailable and keeps the reserved cost as chargeable', async (t) => {
  let attempts = 0;
  const dropped = (async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const db = await setup(t, { fetch: dropped });
  const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'AI_ART_UPSTREAM_UNAVAILABLE');
  // 네 시안 요청이 각각 한 번씩만 나갔고(다시 보내지 않음) 예상 비용이 그대로 남는다(결과를 알 수 없으므로).
  assert.equal(attempts, 4);
  assert.equal(await totalSpend(db.pool), 40_000);
});

test('a 502 or 504 is not retried and keeps the reserved cost as chargeable, for the drafts and for the final', async (t) => {
  for (const status of [502, 504]) {
    const drafts = await setup(t, { handler: () => errorResponse(status, null) });
    const started = await drafts.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
    await drafts.art.drain();
    const failed = await drafts.art.getRound({ merchantId: 'art-a', roundId: started.id });
    assert.equal(failed.status, 'FAILED', `status ${status}`);
    assert.equal(failed.failureCode, 'AI_ART_UPSTREAM_UNAVAILABLE', `status ${status}`);
    // 네 시안 요청이 각각 한 번씩만 나갔고(500·503과 달리 다시 보내지 않음) 예상 비용이 그대로 남는다.
    assert.equal(drafts.fake.calls.length, 4, `status ${status}`);
    assert.equal(await totalSpend(drafts.pool), 40_000, `status ${status}`);

    const final = await setup(t, { handler: (call) => call.path === '/v1/images/edits' ? errorResponse(status, null) : undefined });
    const round = await readyRound(final);
    await final.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' });
    await final.art.drain();
    const failedFinal = await final.art.getRound({ merchantId: 'art-a', roundId: round.id });
    assert.equal(failedFinal.status, 'FAILED', `status ${status}`);
    assert.equal(failedFinal.failureCode, 'AI_ART_UPSTREAM_UNAVAILABLE', `status ${status}`);
    assert.equal(final.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 1, `status ${status}`);
    assert.deepEqual((await spendRows(final.pool)).filter((row) => row.kind === 'FINAL'),
      [{ merchantId: 'art-a', kind: 'FINAL', microUsd: 180_000 }], `status ${status}`);
  }
});

test('a failed final keeps the four drafts visible and marks FAILED with the pick', async (t) => {
  const db = await setup(t, {
    handler: (call) => call.path === '/v1/images/edits' ? errorResponse(400, 'moderation_blocked') : undefined,
  });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.failureCode, 'AI_ART_MODERATION_BLOCKED');
  assert.equal(failed.drafts.length, 4);
  assert.equal(failed.chosenIndex, 1);
  assert.equal(failed.final, null);
  const finals = (await spendRows(db.pool)).filter((row) => row.kind === 'FINAL');
  assert.deepEqual(finals, [{ merchantId: 'art-a', kind: 'FINAL', microUsd: 0 }]);
  await assert.rejects(db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
  // 상태 조회도 같은 라운드를 시안과 함께 보여 준다.
  const state = await db.art.getState('art-a');
  assert.equal(state.round?.id, round.id);
  assert.equal(state.round?.drafts.length, 4);
  await readyRound(db);
});

test('the round view carries no draft images while the final is being made and gets them back if it fails', async (t) => {
  const held = makeGate();
  let failEdit = true;
  const db = await setup(t, {
    gate: held, gateEditsOnly: true,
    handler: (call) => call.path === '/v1/images/edits' && failEdit ? errorResponse(500, null) : undefined,
  });
  const round = await readyRound(db);
  const started = await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 2, accountId: 'staff-a' });
  assert.equal(started.status, 'FINALIZING');
  assert.equal(started.chosenIndex, 2);
  // 202 응답·라운드 조회·상태 조회 어디에도 시안 이미지가 없다(3초마다 읽는 모습이라 대역폭을 아낀다).
  assert.deepEqual(started.drafts, []);
  assert.equal(started.final, null);
  const polled = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(polled.status, 'FINALIZING');
  assert.deepEqual(polled.drafts, []);
  const state = await db.art.getState('art-a');
  assert.equal(state.round?.status, 'FINALIZING');
  assert.deepEqual(state.round?.drafts, []);
  assert.equal(JSON.stringify(state).includes('data:image'), false);
  held.release();
  await db.art.drain();
  // 실패하면 고른 시안과 함께 시안 네 장이 다시 보인다(같은 시안들로 다시 고를 수 있게).
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.drafts.length, 4);
  assert.equal(failed.chosenIndex, 2);
  failEdit = false;
});

test('after a failed final the same round can choose again: it is a new final, counted against the limit and the budget', async (t) => {
  let edits = 0;
  const db = await setup(t, {
    config: { dailyFinals: 3 },
    handler: (call) => {
      if (call.path !== '/v1/images/edits') return undefined;
      edits += 1;
      return edits === 1 ? errorResponse(400, 'moderation_blocked') : undefined;
    },
  });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' });
  await db.art.drain();
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: round.id })).status, 'FAILED');
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 2 });

  // 다른 시안으로 다시 고른다. 실패 코드는 지워지고 최종이 새로 시작된다.
  const again = await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 3, accountId: 'staff-a' });
  assert.equal(again.status, 'FINALIZING');
  assert.equal(again.chosenIndex, 3);
  assert.equal(again.failureCode, null);
  assert.deepEqual(again.drafts, []);
  await db.art.drain();
  const final = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(final.status, 'FINAL_READY');
  assert.equal(final.chosenIndex, 3);
  assert.equal(final.failureCode, null);
  assert.ok(final.final);
  // 첫 시도(정책 차단, 비용 0)와 다시 만든 최종이 각각 하나의 최종으로 기록되고 하루 한도에 한 번씩 센다.
  const finals = (await spendRows(db.pool)).filter((row) => row.kind === 'FINAL');
  assert.deepEqual(finals.map((row) => row.microUsd), [0, fakeFinalCostMicroUsd]);
  assert.deepEqual((await db.art.getState('art-a')).quota, { draftRoundsLeft: 2, finalsLeft: 1 });
  // 새 시안 라운드를 만들 필요가 없었다.
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 1);
  assert.ok(await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }));
});

test('choosing again after a failed final obeys the daily final limit', async (t) => {
  const db = await setup(t, {
    config: { dailyFinals: 1 },
    handler: (call) => call.path === '/v1/images/edits' ? errorResponse(400, 'moderation_blocked') : undefined,
  });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0, accountId: 'staff-a' });
  await db.art.drain();
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: round.id })).status, 'FAILED');
  // 하루 최종 한도(1)를 이미 썼다: 다시 고를 수 없고 라운드도 호출도 그대로다.
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' }),
    rejectsWith('AI_ART_DAILY_LIMIT', 12 * 60 * 60));
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: round.id })).status, 'FAILED');
  assert.equal((await spendRows(db.pool)).filter((row) => row.kind === 'FINAL').length, 1);
  assert.equal(db.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 1);
  // 다음 날에는 다시 고를 수 있다(이번에도 정책 차단이라 다시 FAILED).
  db.state.now = new Date(db.state.now.getTime() + day);
  const next = await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' });
  assert.equal(next.status, 'FINALIZING');
  await db.art.drain();
  assert.equal(db.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 2);
});

test('choosing again after a failed final obeys the monthly budget', async (t) => {
  const db = await setup(t, {
    config: { monthlyBudgetMicroUsd: 100_000, dailyFinals: 9, dailyDraftRounds: 9 },
    handler: (call) => call.path === '/v1/images/edits' ? errorResponse(400, 'moderation_blocked') : undefined,
  });
  const round = await readyRound(db);
  // 예약(180,000)이 상한을 넘으므로 처음 고르는 것도 다시 고르는 것도 같은 이유로 거절된다.
  await db.pool.query(
    `UPDATE merchant_art_rounds SET status = 'FAILED', chosen_index = 0, failure_code = 'AI_ART_TIMEOUT' WHERE id = $1`, [round.id],
  );
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 1, accountId: 'staff-a' }),
    rejectsWith('AI_ART_BUDGET_EXHAUSTED'));
  const after = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(after.status, 'FAILED');
  assert.equal(after.failureCode, 'AI_ART_TIMEOUT');
  assert.equal(db.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 0);
});

test('choosing again after a failed final is refused while another round of the merchant is in progress', async (t) => {
  let hold: Promise<void> | null = null;
  let release!: () => void;
  const db = await setup(t, {
    handler: async (call) => {
      if (call.path === '/v1/images/edits') return errorResponse(400, 'moderation_blocked');
      if (hold) await hold;
      return undefined;
    },
  });
  try {
    const first = await readyRound(db);
    await db.art.chooseDraft({ merchantId: 'art-a', roundId: first.id, index: 0, accountId: 'staff-a' });
    await db.art.drain();
    assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: first.id })).status, 'FAILED');
    hold = new Promise<void>((resolve) => { release = resolve; });
    const second = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
    assert.equal(second.status, 'DRAFTING');
    await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: first.id, index: 1, accountId: 'staff-a' }),
      rejectsWith('AI_ART_ROUND_IN_PROGRESS'));
    assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: first.id })).status, 'FAILED');
  } finally {
    release?.();
    await db.art.drain();
  }
});

test('a stale final attempt that finishes after the re-chosen attempt is done cannot add its image or change the round', async (t) => {
  const { db, round, first, done, spendIds } = await rechosenAfterStale(t, { firstOutcome: 'success', holdSecond: false });
  await waitFor(async () => (await roundRow(db.pool, round.id)).status === 'FINAL_READY', 'the second attempt to finish');
  const before = await finalImages(db.pool, round.id);
  assert.deepEqual(before.map((image) => image.idx), [3]);

  first.release();
  await db.art.drain();
  // 옛 시도 1의 이미지는 저장되지 않았고 라운드는 시도 2의 결과 그대로다.
  assert.deepEqual(await finalImages(db.pool, round.id), before);
  const row = await roundRow(db.pool, round.id);
  assert.equal(row.status, 'FINAL_READY');
  assert.equal(row.chosen_index, 3);
  assert.equal(row.failure_code, null);
  assert.equal(row.final_spend_id, spendIds[1]);
  assert.equal(done.filter((name) => name === 'FINAL_READY').length, 2);
  // 두 시도의 호출 비용은 각각 자기 행에 실제 값으로 적힌다.
  assert.deepEqual((await spendRows(db.pool)).filter((spend) => spend.kind === 'FINAL').map((spend) => spend.microUsd),
    [fakeFinalCostMicroUsd, fakeFinalCostMicroUsd]);
  const applied = await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' });
  assert.equal(applied.artUrl, `/merchant-art/${before[0]!.sha256}.webp`);
});

test('a stale final attempt that succeeds while the re-chosen attempt is still running changes nothing', async (t) => {
  const { db, round, first, second, done, spendIds, editCalls } =
    await rechosenAfterStale(t, { firstOutcome: 'success', holdSecond: true });
  await waitFor(() => editCalls() === 2, 'the second final attempt to reach OpenAI');

  first.release();
  await waitFor(() => done.includes('FINAL_READY'), 'the stale attempt to finish its writes');
  // 옛 시도가 끝났어도 라운드는 시도 2가 만드는 중이고, 옛 시도의 이미지는 없다.
  const row = await roundRow(db.pool, round.id);
  assert.equal(row.status, 'FINALIZING');
  assert.equal(row.chosen_index, 3);
  assert.equal(row.failure_code, null);
  assert.deepEqual(await finalImages(db.pool, round.id), []);
  const view = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(view.status, 'FINALIZING');
  assert.equal(view.final, null);
  await assert.rejects(db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));

  second.release();
  await db.art.drain();
  const finished = await roundRow(db.pool, round.id);
  assert.equal(finished.status, 'FINAL_READY');
  assert.equal(finished.chosen_index, 3);
  assert.equal(finished.final_spend_id, spendIds[1]);
  assert.deepEqual((await finalImages(db.pool, round.id)).map((image) => image.idx), [3]);
  assert.ok(await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }));
});

test('a stale final attempt that fails while the re-chosen attempt is still running cannot fail the round', async (t) => {
  const { db, round, first, second, done, spendIds, editCalls } =
    await rechosenAfterStale(t, { firstOutcome: 'failure', holdSecond: true });
  await waitFor(() => editCalls() === 2, 'the second final attempt to reach OpenAI');

  first.release();
  await waitFor(() => done.includes('FAILED'), 'the stale attempt to write its failure');
  const row = await roundRow(db.pool, round.id);
  assert.equal(row.status, 'FINALIZING');
  assert.equal(row.failure_code, null);
  assert.equal(row.final_spend_id, spendIds[1]);
  // 옛 시도의 정책 차단은 자기 비용 행만 0으로 고친다.
  assert.deepEqual((await spendRows(db.pool)).filter((spend) => spend.kind === 'FINAL').map((spend) => spend.microUsd),
    [0, 180_000]);

  second.release();
  await db.art.drain();
  const finished = await roundRow(db.pool, round.id);
  assert.equal(finished.status, 'FINAL_READY');
  assert.equal(finished.failure_code, null);
  assert.deepEqual((await finalImages(db.pool, round.id)).map((image) => image.idx), [3]);
  assert.ok(await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }));
});

test('a round that failed while drawing the drafts cannot be chosen from: it needs a new round', async (t) => {
  const db = await setup(t, { handler: () => errorResponse(400, 'moderation_blocked') });
  const started = await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const failed = await db.art.getRound({ merchantId: 'art-a', roundId: started.id });
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.chosenIndex, null);
  assert.deepEqual(failed.drafts, []);
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
  // 늦게 도착한 시안 조각이 남아 있어도(중단된 라운드) 고를 수 없고 보이지도 않는다.
  for (let index = 0; index < 4; index++) {
    await db.pool.query(
      `INSERT INTO merchant_art_images (round_id, kind, idx, style, image, sha256)
       VALUES ($1, 'DRAFT', $2, 'stamp', $3, $4)`,
      [started.id, index, fakeWebp(`late-${index}`), `${index}`.repeat(64)],
    );
  }
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: started.id, index: 0, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
  assert.deepEqual((await db.art.getRound({ merchantId: 'art-a', roundId: started.id })).drafts, []);
  assert.equal(db.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 0);
});

test('the final reserves 180,000 micro USD before the call and is counted at its real cost afterwards', async (t) => {
  const held = makeGate();
  const db = await setup(t, { gate: held, gateEditsOnly: true });
  const round = await readyRound(db);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0, accountId: 'staff-a' });
  assert.deepEqual((await spendRows(db.pool)).filter((row) => row.kind === 'FINAL'),
    [{ merchantId: 'art-a', kind: 'FINAL', microUsd: 180_000 }]);
  held.release();
  await db.art.drain();
  assert.deepEqual((await spendRows(db.pool)).filter((row) => row.kind === 'FINAL'),
    [{ merchantId: 'art-a', kind: 'FINAL', microUsd: fakeFinalCostMicroUsd }]);
});

test('a failed view read after the commit cannot strand a round: the drafts and the final still start', async (t) => {
  const armed = { armed: false };
  const db = await setup(t, { wrapPool: failingRoundViewOnce(armed) });
  armed.armed = true;
  await assert.rejects(db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' }), /view read failed/);
  await db.art.drain();
  // 응답은 실패했지만 라운드는 DRAFTING에 갇히지 않고 끝까지 간다(시안 네 장이 만들어지고 호출도 네 번 갔다).
  const state = await db.art.getState('art-a');
  assert.equal(state.round?.status, 'DRAFTS_READY');
  assert.equal(state.round?.drafts.length, 4);
  assert.equal(db.fake.calls.length, 4);
  assert.equal((await spendRows(db.pool)).filter((row) => row.kind === 'DRAFT').length, 4);

  armed.armed = true;
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: state.round!.id, index: 1, accountId: 'staff-a' }), /view read failed/);
  await db.art.drain();
  const final = await db.art.getRound({ merchantId: 'art-a', roundId: state.round!.id });
  assert.equal(final.status, 'FINAL_READY');
  assert.equal(db.fake.calls.filter((call) => call.path === '/v1/images/edits').length, 1);
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

test('creating a round removes this merchant\'s unapplied rounds older than 30 days and the images of rounds applied over 30 days ago', async (t) => {
  const db = await setup(t);
  const old = new Date(noon.getTime() - 31 * day);
  const recent = new Date(noon.getTime() - 29 * day);
  const ids: Record<string, string> = {};
  for (const [name, merchantId, status, createdAt] of [
    ['oldFailed', 'art-a', 'FAILED', old], ['oldReady', 'art-a', 'DRAFTS_READY', old],
    ['oldApplied', 'art-a', 'APPLIED', old], ['recentApplied', 'art-a', 'APPLIED', recent],
    ['recentReady', 'art-a', 'DRAFTS_READY', recent],
    ['otherMerchantOld', 'art-b', 'FAILED', old], ['otherMerchantOldApplied', 'art-b', 'APPLIED', old],
  ] as const) {
    ids[name] = randomUUID();
    await db.pool.query(
      `INSERT INTO merchant_art_rounds (id, merchant_id, status, business_date, created_at, updated_at)
       VALUES ($1, $2, $3, '2026-08-01', $4, $4)`,
      [ids[name], merchantId, status, createdAt],
    );
    for (const kind of ['DRAFT', 'FINAL']) {
      await db.pool.query(
        `INSERT INTO merchant_art_images (round_id, kind, idx, style, image, sha256)
         VALUES ($1, $2, 0, 'stamp', $3, $4)`,
        [ids[name], kind, Buffer.from(name), 'd'.repeat(64)],
      );
    }
  }
  await db.art.createRound({ merchantId: 'art-a', accountId: 'staff-a' });
  await db.art.drain();
  const left = (await db.pool.query<{ id: string }>('SELECT id FROM merchant_art_rounds')).rows.map((row) => row.id);
  // 적용된 라운드의 행은 30일이 지나도 남는다(다시 눌렀을 때 같은 결과를 주는 멱등 기록).
  for (const name of ['oldApplied', 'recentApplied', 'recentReady', 'otherMerchantOld', 'otherMerchantOldApplied']) {
    assert.ok(left.includes(ids[name]!), name);
  }
  for (const name of ['oldFailed', 'oldReady']) assert.equal(left.includes(ids[name]!), false, name);
  const withImages = (await db.pool.query<{ round_id: string }>(
    `SELECT DISTINCT round_id FROM merchant_art_images WHERE sha256 = $1`, ['d'.repeat(64)],
  )).rows.map((row) => row.round_id);
  // 30일 지난 적용 라운드의 이미지(시안·최종)만 더 지워진다. 최근 적용분과 다른 가게의 이미지는 그대로다.
  assert.deepEqual(withImages.sort(), [ids.recentApplied, ids.recentReady, ids.otherMerchantOld, ids.otherMerchantOldApplied].sort());
});

test('applying deletes that round\'s draft images and keeps the final and the applied art', async (t) => {
  const db = await setup(t);
  const round = await finalRound(db);
  const count = async (kind: string) => (await db.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM merchant_art_images WHERE round_id = $1 AND kind = $2', [round.id, kind],
  )).rows[0]!.n;
  assert.equal(await count('DRAFT'), 4);
  const applied = await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' });
  assert.equal(await count('DRAFT'), 0);
  assert.equal(await count('FINAL'), 1);
  // 다시 눌러도 같은 결과이고, 적용된 라운드 조회에는 시안이 없다.
  assert.deepEqual(await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }), applied);
  const view = await db.art.getRound({ merchantId: 'art-a', roundId: round.id });
  assert.equal(view.status, 'APPLIED');
  assert.deepEqual(view.drafts, []);
  // 오래 지나 이미지까지 정리된 뒤에도 같은 결과다(그림은 merchant_art에 있다).
  await db.pool.query('DELETE FROM merchant_art_images WHERE round_id = $1', [round.id]);
  assert.deepEqual(await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' }), applied);
  assert.equal((await db.art.getRound({ merchantId: 'art-a', roundId: round.id })).final, null);
  assert.ok(await db.art.getPublicImage(applied.artUrl.slice('/merchant-art/'.length, -'.webp'.length)));
});

test('two merchants applying the very same picture both succeed and the public image stays available until the last reset', async (t) => {
  const same = fakeWebp('identical-final');
  const db = await setup(t, { handler: () => imageResponse(same) });
  const a = await finalRound(db, 'art-a', 0);
  const b = await finalRound(db, 'art-b', 1);
  const appliedA = await db.art.apply({ merchantId: 'art-a', roundId: a.id, accountId: 'staff-a' });
  const appliedB = await db.art.apply({ merchantId: 'art-b', roundId: b.id, accountId: 'staff-b' });
  assert.equal(appliedA.artUrl, appliedB.artUrl);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 2);
  const sha = appliedA.artUrl.slice('/merchant-art/'.length, -'.webp'.length);
  assert.deepEqual(await db.art.getPublicImage(sha), same);
  assert.deepEqual(await db.art.getPublicImage(sha), same);
  await db.art.reset({ merchantId: 'art-a', accountId: 'staff-a' });
  assert.deepEqual(await db.art.getPublicImage(sha), same);
  await db.art.reset({ merchantId: 'art-b', accountId: 'staff-b' });
  assert.equal(await db.art.getPublicImage(sha), null);
});

test('only the current applied image is public, and a new apply replaces the previous one', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 5, dailyFinals: 5 } });
  const first = await finalRound(db, 'art-a', 0);
  const appliedFirst = await db.art.apply({ merchantId: 'art-a', roundId: first.id, accountId: 'staff-a' });
  const shaFirst = appliedFirst.artUrl.slice('/merchant-art/'.length, -'.webp'.length);
  assert.ok(await db.art.getPublicImage(shaFirst));

  const second = await finalRound(db, 'art-a', 3);
  // 적용 전에는 첫 그림이 계속 공개이고, 새 그림은 아직 공개가 아니다.
  const secondSha = (await db.pool.query<{ sha256: string }>(
    `SELECT sha256 FROM merchant_art_images WHERE round_id = $1 AND kind = 'FINAL'`, [second.id],
  )).rows[0]!.sha256;
  assert.equal(await db.art.getPublicImage(secondSha), null);
  const appliedSecond = await db.art.apply({ merchantId: 'art-a', roundId: second.id, accountId: 'staff-a' });
  assert.equal(appliedSecond.artUrl, `/merchant-art/${secondSha}.webp`);
  assert.equal(await db.art.getPublicImage(shaFirst), null);
  assert.ok(await db.art.getPublicImage(secondSha));
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 1);
  // 옛 라운드는 APPLIED로 남지만 다시 적용할 수는 없다.
  await assert.rejects(db.art.apply({ merchantId: 'art-a', roundId: first.id, accountId: 'staff-a' }), rejectsWith('AI_ART_ROUND_STATE'));
  // 다른 가게의 그림은 서로 섞이지 않는다.
  const other = await finalRound(db, 'art-b', 1);
  const appliedOther = await db.art.apply({ merchantId: 'art-b', roundId: other.id, accountId: 'staff-b' });
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
  await assert.rejects(db.art.chooseDraft({ merchantId: 'art-a', roundId: randomUUID(), index: 0, accountId: 'staff-a' }), rejectsWith('AI_ART_NOT_CONFIGURED'));
  await db.art.reset({ merchantId: 'art-a', accountId: 'staff-a' });
  assert.equal(await db.art.getPublicImage('0'.repeat(64)), null);
  assert.equal(db.fake.calls.length, 0);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art_rounds')).rows[0]!.n, 0);
});

test('MANAGE_ART is granted to active owners only by default and to active staff too when the environment allows it', async (t) => {
  const { pool } = await setup(t);
  const strangers = [
    ['gone-a', 'art-a'], ['staff-b', 'art-a'], ['owner-a', 'art-b'], ['nobody', 'art-a'], ['staff-a', 'no-such-merchant'],
  ] as const;
  const grantedTo = async (access: PostgresMerchantAccessControl, accountId: string, merchantId = 'art-a') => {
    try {
      await access.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
      return true;
    } catch (error) {
      assert.ok(error instanceof MerchantAccessError, `${accountId}@${merchantId}`);
      return false;
    }
  };

  // 기본(운영): 활성 OWNER만. STAFF는 거절된다.
  for (const access of [new PostgresMerchantAccessControl(pool), new PostgresMerchantAccessControl(pool, { staffMayManageArt: false })]) {
    const grant = await access.requirePermission({ accountId: 'owner-a', merchantId: 'art-a', permission: 'MANAGE_ART' });
    assert.equal(grant.merchantId, 'art-a');
    // 응답에 실리는 권한 목록은 예전 앱 파서와 같은 두 값 그대로다.
    assert.deepEqual(grant.permissions, ['VIEW_MERCHANT', 'CONFIRM_VISIT']);
    assert.equal(await grantedTo(access, 'staff-a'), false);
    for (const [accountId, merchantId] of strangers) assert.equal(await grantedTo(access, accountId, merchantId), false, `${accountId}@${merchantId}`);
    // 다른 권한은 STAFF에게도 그대로다.
    await access.requirePermission({ accountId: 'staff-a', merchantId: 'art-a', permission: 'CONFIRM_VISIT' });
  }

  // 시연(AI_ART_STAFF_MAY_MANAGE=true): 활성 OWNER·STAFF. 다른 가게·해지된 멤버·없는 계정은 여전히 거절이다.
  const showcase = new PostgresMerchantAccessControl(pool, { staffMayManageArt: true });
  for (const accountId of ['owner-a', 'staff-a']) {
    const grant = await showcase.requirePermission({ accountId, merchantId: 'art-a', permission: 'MANAGE_ART' });
    assert.equal(grant.merchantId, 'art-a');
    assert.deepEqual(grant.permissions, ['VIEW_MERCHANT', 'CONFIRM_VISIT']);
  }
  for (const [accountId, merchantId] of strangers) assert.equal(await grantedTo(showcase, accountId, merchantId), false, `${accountId}@${merchantId}`);
  await assert.rejects(showcase.requirePermission({
    accountId: 'staff-a', merchantId: 'art-a', permission: 'MANAGE_EVERYTHING' as never,
  }), MerchantAccessError);
});

test('account deletion clears the requester of art rounds in the same transaction and keeps the merchant assets', async (t) => {
  const db = await setup(t, { lifecycle: true });
  const round = await finalRound(db, 'art-a', 1);
  await db.art.apply({ merchantId: 'art-a', roundId: round.id, accountId: 'staff-a' });
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
  assert.equal((await db.pool.query("SELECT count(*)::int AS n FROM ai_art_spend WHERE account_id = 'staff-a'")).rows[0]!.n, 0);
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
    new PostgresMerchantAccessControl(db.pool, { staffMayManageArt: true }),
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
    configured: true, current: null, quota: { draftRoundsLeft: 3, finalsLeft: 3,
      account: { draftRoundsLeft: 3, finalsLeft: 3, resetsAt: '2026-09-29T15:00:00.000Z', cooldownUntil: null },
    }, round: null,
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

test('HTTP: by default only the owner reaches the art routes, staff needs AI_ART_STAFF_MAY_MANAGE', async (t) => {
  const db = await setup(t);
  const build = (staffMayManageArt: boolean) => {
    const server = createApiServer(
      new WalletChallengeService({
        store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
        uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 5 * 60 * 1000,
      }),
      developmentHeaderAccountResolver, undefined, new PostgresMerchantAccessControl(db.pool, { staffMayManageArt }),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, db.art,
    );
    return server;
  };
  const listen = async (server: ReturnType<typeof build>) => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
  };
  const request = (base: string, method: string, path: string, account: string) => fetch(`${base}${path}`, {
    method, headers: { 'x-account-id': account, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: '{}' }),
  });
  const ownerOnly = await listen(build(false));
  const withStaff = await listen(build(true));
  const art = '/merchant/merchants/art-a/art';

  // STAFF는 조회·시안·되돌리기 어느 것도 못 하고, 어떤 비용도 나가지 않는다.
  for (const [method, path] of [['GET', art], ['POST', `${art}/rounds`], ['DELETE', art]] as const) {
    const denied = await request(ownerOnly, method, path, 'staff-a');
    assert.equal(denied.status, 403, `${method} ${path}`);
    assert.deepEqual(await denied.json(), { code: 'MERCHANT_ACCESS_DENIED' });
  }
  assert.equal(db.fake.calls.length, 0);
  assert.equal((await spendRows(db.pool)).length, 0);

  // OWNER는 된다.
  assert.equal((await request(ownerOnly, 'GET', art, 'owner-a')).status, 200);
  assert.equal((await request(ownerOnly, 'POST', `${art}/rounds`, 'owner-a')).status, 202);
  await db.art.drain();
  assert.equal(db.fake.calls.length, 4);

  // 켠 환경에서는 STAFF도 된다(해지된 멤버·다른 가게 멤버는 여전히 아니다).
  assert.equal((await request(withStaff, 'GET', art, 'staff-a')).status, 200);
  assert.equal((await request(withStaff, 'GET', art, 'gone-a')).status, 403);
  assert.equal((await request(withStaff, 'GET', art, 'staff-b')).status, 403);
});

test('HTTP: daily limit answers 429 with Retry-After and a missing key answers 503 while reads keep working', async (t) => {
  const db = await setup(t, { config: { dailyDraftRounds: 1 } });
  const build = (art: PostgresMerchantArtService) => createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 5 * 60 * 1000,
    }),
    developmentHeaderAccountResolver, undefined, new PostgresMerchantAccessControl(db.pool, { staffMayManageArt: true }),
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

// ---- Issue #264: 그림 변경은 트랜잭션 안에서 멤버십·MANAGE_ART를 다시 확인한다 ---------------------------------

const artMethods = ['createRound', 'chooseDraft', 'apply', 'reset'] as const;
type ArtMethod = (typeof artMethods)[number];

const accessDenied = (error: unknown) => error instanceof MerchantAccessError && error.code === 'MERCHANT_ACCESS_DENIED';

// 그 메서드를 부를 수 있는 상태를 활성 OWNER(owner-a)로 만들어 두고, 아무 계정으로 그 메서드를 부르는 함수와 상태 요약을 돌려준다.
async function prepareArtMethod(db: Db, method: ArtMethod) {
  const merchantId = 'art-a';
  const owner = 'owner-a';
  let roundId = '';
  if (method === 'chooseDraft') roundId = (await readyRound(db, merchantId, owner)).id;
  if (method === 'apply') roundId = (await finalRound(db, merchantId, 1, owner)).id;
  if (method === 'reset') {
    const round = await finalRound(db, merchantId, 1, owner);
    await db.art.apply({ merchantId, roundId: round.id, accountId: owner });
  }
  const call = (accountId: string): Promise<unknown> => {
    switch (method) {
      case 'createRound': return db.art.createRound({ merchantId, accountId });
      case 'chooseDraft': return db.art.chooseDraft({ merchantId, roundId, index: 1, accountId });
      case 'apply': return db.art.apply({ merchantId, roundId, accountId });
      case 'reset': return db.art.reset({ merchantId, accountId });
    }
  };
  const snapshot = async () => ({
    rounds: (await db.pool.query(
      'SELECT id, status, chosen_index, failure_code, final_spend_id FROM merchant_art_rounds ORDER BY id',
    )).rows,
    images: (await db.pool.query('SELECT round_id, kind, idx FROM merchant_art_images ORDER BY round_id, kind, idx')).rows,
    art: (await db.pool.query('SELECT merchant_id, sha256, round_id FROM merchant_art ORDER BY merchant_id')).rows,
    spend: await spendRows(db.pool),
    openAiCalls: db.fake.calls.length,
  });
  return { call, snapshot };
}

for (const method of artMethods) {
  test(`${method} checks membership and role again inside its transaction: outsiders, revoked and demoted accounts are denied and nothing changes (#264)`, async (t) => {
    // 활성 OWNER만 그림을 바꿀 수 있는 환경(운영 기본값)에서 본다.
    const db = await setup(t, { staffMayManageArt: false });
    const { call, snapshot } = await prepareArtMethod(db, method);
    const before = await snapshot();

    // 처음부터 자격이 없다: 해지된 직원, 다른 가게 직원, 이 환경에서 못 쓰는 STAFF, 무소속.
    for (const accountId of ['gone-a', 'staff-b', 'staff-a', 'nobody']) {
      await assert.rejects(call(accountId), accessDenied, accountId);
    }
    // 소유자였다가 강등됐다(요청 시작 검사 뒤에 일어난 일을 서비스가 다시 본다).
    await db.pool.query(`UPDATE merchant_members SET role = 'STAFF' WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`);
    await assert.rejects(call('owner-a'), accessDenied, 'demoted owner');
    // 회수됐다.
    await db.pool.query(
      `UPDATE merchant_members SET status = 'REVOKED', revoked_at = now() WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`,
    );
    await assert.rejects(call('owner-a'), accessDenied, 'revoked owner');
    assert.deepEqual(await snapshot(), before);

    // 대조: 자격을 되돌리면 같은 호출이 통과한다(거절 원인은 멤버십이었다).
    await db.pool.query(
      `UPDATE merchant_members SET role = 'OWNER', status = 'ACTIVE', revoked_at = NULL
       WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`,
    );
    await call('owner-a');
  });
}

// 활성 STAFF는 STAFF 허용 환경에서만 통과한다: 강등된 소유자도 그 환경에서는 STAFF로서 계속 쓸 수 있다.
test('a demoted owner keeps working only where staff may manage art (#264)', async (t) => {
  const db = await setup(t, { staffMayManageArt: true });
  const round = await readyRound(db, 'art-a', 'owner-a');
  await db.pool.query(`UPDATE merchant_members SET role = 'STAFF' WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`);
  await db.art.chooseDraft({ merchantId: 'art-a', roundId: round.id, index: 0, accountId: 'owner-a' });
});

const lockWaits = async (pool: Pool) => (await pool.query(
  `SELECT 1 FROM pg_stat_activity
   WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`,
)).rowCount;

for (const method of artMethods) {
  for (const change of ['revoked', 'demoted'] as const) {
    test(`${method} started while a ${change === 'revoked' ? 'revocation' : 'demotion'} holds the store row is denied once it commits and changes nothing (#264)`, async (t) => {
      const db = await setup(t, { staffMayManageArt: false });
      const { call, snapshot } = await prepareArtMethod(db, method);
      const before = await snapshot();

      // 회수·강등 트랜잭션처럼 가게 행을 FOR UPDATE로 잡고 멤버십을 바꾸되 아직 커밋하지 않는다.
      const admin = await db.pool.connect();
      let outcome: Promise<unknown> | undefined;
      try {
        await admin.query('BEGIN');
        await admin.query(`SELECT id FROM merchants WHERE id = 'art-a' FOR UPDATE`);
        await admin.query(
          change === 'revoked'
            ? `UPDATE merchant_members SET status = 'REVOKED', revoked_at = now() WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`
            : `UPDATE merchant_members SET role = 'STAFF' WHERE merchant_id = 'art-a' AND account_id = 'owner-a'`,
        );
        // 이 시점의 멤버십은 아직 활성 OWNER다. 호출은 가게 행 잠금 앞에서 기다려야 한다.
        outcome = call('owner-a').then(() => new Error('the art call resolved'), (error: unknown) => error);
        await waitFor(async () => (await lockWaits(db.pool)) === 1, 'the art call to wait on the store row lock');
        assert.deepEqual(await snapshot(), before);
        await admin.query('COMMIT');
      } finally {
        await admin.query('ROLLBACK').catch(() => undefined);
        admin.release();
      }

      const error = await outcome!;
      assert.ok(accessDenied(error), `expected MERCHANT_ACCESS_DENIED, got ${String(error)}`);
      assert.deepEqual(await snapshot(), before);
    });
  }
}

// 회수를 실제 코드(PostgresStaffRegistration.revoke)로 한다: 대상 계정 advisory → 관리자 행 → 가게 행 FOR UPDATE → 멤버 행 UPDATE 순서다.
// 그림 서비스는 accountLifecycle 없이 만들어(assertActive가 계정 advisory 잠금으로 먼저 막지 못하게) 가게 행 FOR SHARE만으로 직렬화되는지 본다.
// 나중에 그림 쪽이 가게 행을 먼저 잠그지 않게 바뀌거나 회수가 가게 행을 잠그지 않게 바뀌면 이 시험이 잡는다.
for (const method of artMethods) {
  test(`${method} started while the real staff revoke holds the store row is denied once the revoke commits (#264)`, async (t) => {
    const db = await setup(t, { staffMayManageArt: true });
    const { call, snapshot } = await prepareArtMethod(db, method);
    const before = await snapshot();
    const adminId = `admin-${randomUUID()}`;
    await db.pool.query(`UPDATE merchants SET is_demo = false WHERE id = 'art-a'`);
    await db.pool.query(
      `INSERT INTO auth_identities(provider, subject, account_id, created_at) VALUES ('google', $1, $2, now())`,
      [`admin-sub-${randomUUID()}`, adminId],
    );
    await db.pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    try {
      const registration = new PostgresStaffRegistration(db.pool, hmacSecret);

      // 회수가 가게 행을 잠근 뒤 멤버 행 UPDATE에서 멈추도록, 다른 연결이 그 멤버 행을 잡아 둔다.
      const blocker = await db.pool.connect();
      let revoke: Promise<void> | undefined;
      let outcome: Promise<unknown> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(`SELECT 1 FROM merchant_members WHERE merchant_id = 'art-a' AND account_id = 'staff-a' FOR UPDATE`);
        revoke = registration.revoke(adminId, 'art-a', 'staff-a');
        revoke.catch(() => undefined);
        await waitFor(async () => (await lockWaits(db.pool)) === 1, 'the revoke to wait on the member row');
        // STAFF가 허용된 환경이고 멤버십은 아직 활성이다. 호출은 회수가 잡은 가게 행 잠금 앞에서 기다려야 한다.
        outcome = call('staff-a').then(() => new Error('the art call resolved'), (error: unknown) => error);
        await waitFor(async () => (await lockWaits(db.pool)) === 2, 'the art call to wait on the store row lock');
        assert.deepEqual(await snapshot(), before);
        await blocker.query('ROLLBACK');
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        blocker.release();
        await revoke?.catch(() => undefined);
      }

      await revoke;
      const error = await outcome!;
      assert.ok(accessDenied(error), `expected MERCHANT_ACCESS_DENIED, got ${String(error)}`);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await db.pool.query(
        `SELECT status FROM merchant_members WHERE merchant_id = 'art-a' AND account_id = 'staff-a'`,
      )).rows[0]!.status, 'REVOKED');
    } finally {
      await db.pool.query('DELETE FROM platform_admins WHERE account_id = $1', [adminId]);
      await db.pool.query('DELETE FROM auth_identities WHERE account_id = $1', [adminId]);
    }
  });
}

// 계정 삭제는 가게 행을 잠그지 않고 merchant_members를 회수하므로, 그림 변경은 계정 advisory 잠금(assertActive)으로 삭제와 직렬화한다.
// (1) 삭제가 아직 커밋되지 않은 채 잠금을 쥐고 있을 때 시작한 호출은 기다렸다가 커밋 뒤 ACCOUNT_DELETED로 거절되고 상태는 그대로다.
for (const method of artMethods) {
  test(`${method} started while an account deletion holds the account lock is rejected as ACCOUNT_DELETED once it commits (#264)`, async (t) => {
    const db = await setup(t, { staffMayManageArt: true, lifecycle: true });
    const { call, snapshot } = await prepareArtMethod(db, method);
    const before = await snapshot();
    const deletion = new PostgresAccountDeletionService(db.pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', accountLifecycle: db.lifecycle,
    });

    const deleter = await db.pool.connect();
    let outcome: Promise<unknown> | undefined;
    try {
      await deleter.query('BEGIN');
      await db.lifecycle.lockForDeletion(deleter, 'owner-a');
      await deletion.forgetInTransaction(deleter, 'owner-a', db.now());
      outcome = call('owner-a').then(() => new Error('the art call resolved'), (error: unknown) => error);
      await waitFor(async () => (await lockWaits(db.pool)) === 1, 'the art call to wait on the account lock');
      assert.deepEqual(await snapshot(), before);
      await deleter.query('COMMIT');
    } finally {
      await deleter.query('ROLLBACK').catch(() => undefined);
      deleter.release();
    }

    const error = await outcome!;
    assert.ok(rejectsWith('ACCOUNT_DELETED')(error), `expected ACCOUNT_DELETED, got ${String(error)}`);
    assert.deepEqual(await snapshot(), before);
  });
}

// (2) 호출이 검사를 마치고 가게별 잠금 앞에서 기다리는 동안 시작한 삭제는 그 호출이 커밋될 때까지 기다린다(삭제가 먼저 끝난 뒤 호출이 커밋되지 않는다).
for (const method of artMethods) {
  test(`an account deletion cannot finish while its ${method} call sits between the checks and the commit (#264)`, async (t) => {
    const db = await setup(t, { staffMayManageArt: true, lifecycle: true });
    const { call } = await prepareArtMethod(db, method);
    const deletion = new PostgresAccountDeletionService(db.pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', accountLifecycle: db.lifecycle,
    });

    // 이 가게의 그림 잠금을 다른 연결이 쥐고 있어, 호출은 계정·멤버십 확인을 마친 채 그 앞에서 기다린다.
    const holder = await db.pool.connect();
    let art: Promise<unknown> | undefined;
    let removal: ReturnType<typeof deletion.requestDeletion> | undefined;
    let removalSettled = false;
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT pg_advisory_xact_lock(hashtextextended('ai-art-merchant:art-a', 0))`);
      art = call('owner-a');
      art.catch(() => undefined);
      await waitFor(async () => (await lockWaits(db.pool)) === 1, 'the art call to wait on the store lock');
      removal = deletion.requestDeletion({ accountId: 'owner-a', confirmation: 'DELETE MY ACCOUNT' });
      removal.then(() => { removalSettled = true; }, () => { removalSettled = true; });
      // 삭제는 그림 호출의 트랜잭션이 쥔 계정 잠금 앞에서 기다린다.
      await waitFor(async () => (await lockWaits(db.pool)) === 2, 'the deletion to wait on the account lock');
      assert.equal(removalSettled, false);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    await art!;
    const result = await removal!;
    assert.ok(result.requestId);
    assert.equal(removalSettled, true);
  });
}

test('HTTP: an art request whose access was lost after the permission check is denied by the service and nothing changes (#264)', async (t) => {
  const db = await setup(t, { staffMayManageArt: false });
  const { snapshot } = await prepareArtMethod(db, 'apply');
  const before = await snapshot();
  const roundId = before.rounds[0]!.id as string;
  // 요청 시작의 권한 검사는 통과했다고 가정한다(그 뒤 본문을 읽는 사이에 회수·강등된 경우). 서비스가 자기 트랜잭션에서 다시 거절해야 한다.
  const staleAccess = {
    requirePermission: async (input: { merchantId: string }) => ({
      merchantId: input.merchantId, role: 'OWNER' as const, permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'] as const,
    }),
  };
  const server = createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 5 * 60 * 1000,
    }),
    developmentHeaderAccountResolver, undefined, staleAccess,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, db.art,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const base = `http://127.0.0.1:${address.port}`;
  const art = `${base}/merchant/merchants/art-a/art`;
  const send = (account: string, method: string, url: string, body: string) => fetch(url, {
    method, headers: { 'x-account-id': account, 'content-type': 'application/json' }, body,
  });

  for (const account of ['gone-a', 'staff-a']) {
    for (const [method, url, body] of [
      ['POST', `${art}/rounds`, '{}'],
      ['POST', `${art}/rounds/${roundId}/choose`, '{"index":1}'],
      ['POST', `${art}/rounds/${roundId}/apply`, '{}'],
      ['DELETE', art, '{}'],
    ] as const) {
      const response = await send(account, method, url, body);
      assert.equal(response.status, 403, `${account} ${method} ${url}`);
      assert.deepEqual(await response.json(), { code: 'MERCHANT_ACCESS_DENIED' });
    }
  }
  assert.deepEqual(await snapshot(), before);

  // 대조: 활성 OWNER는 같은 경로가 통과한다(서버가 accountId를 넘긴다).
  const applied = await send('owner-a', 'POST', `${art}/rounds/${roundId}/apply`, '{}');
  assert.equal(applied.status, 200);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM merchant_art')).rows[0]!.n, 1);
});
