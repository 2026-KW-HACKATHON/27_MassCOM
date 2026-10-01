import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { OpenAiImageClient } from '../ai-art-client.js';
import { resolveAiArtConfig } from '../ai-art-rules.js';
import { fakeOpenAiFetch } from '../ai-art-test-support.js';
import { AuthSessionError } from '../auth-session.js';
import { MerchantArtError } from '../merchant-art.js';
import { PostgresAuthSessionService } from '../postgres/auth-session.js';
import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import { PostgresMerchantAccessControl } from '../postgres/merchant-access.js';
import { PostgresMerchantArtService } from '../postgres/merchant-art.js';
import { PostgresMerchantCatalog } from '../postgres/merchant-catalog.js';
import { runMigrations } from '../postgres/migrate.js';
import { PostgresRecommendationSource } from '../postgres/recommendation.js';
import { createApiServer, createBearerAccountResolver } from '../server.js';
import { InMemoryChallengeStore, WalletChallengeService } from '../wallet-challenge-service.js';
import { ShowcaseAccessRequestError, ShowcaseAccessRequestService } from './access-requests.js';
import { GUEST_TRIAL_TTL_MS, GuestTrialError, ShowcaseGuestTrialService } from './guest-trials.js';
import { seedLocalShowcase, SHOWCASE_MERCHANT_ID } from './local-seed.js';

const execFileAsync = promisify(execFile);
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
const secret = 'test-only-guest-trial-secret-at-least-32-bytes-long';
const refusingVerifier = { verify: async (): Promise<never> => { throw new AuthSessionError('SESSION_INVALID'); } };

/** A fresh `<prefix>_<uuid>_test` database, migrated (and seeded with the three demo merchants when `seed`). */
async function withFreshDatabase(
  prefix: string, seed: boolean, run: (pool: Pool, url: URL) => Promise<void>,
): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must end in _test');
  }
  const admin = new Pool({ connectionString });
  const databaseName = `${prefix}_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString(), max: 12 });
    try {
      await runMigrations(pool);
      if (seed) await seedLocalShowcase(pool);
      await run(pool, url);
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

const withShowcaseDatabase = (run: (pool: Pool, url: URL) => Promise<void>) =>
  withFreshDatabase('masscom_showcase_ci', true, run);

async function startApiServer(t: TestContext, pool: Pool, now: () => Date): Promise<string> {
  const sessions = new PostgresAuthSessionService(pool, { verifier: refusingVerifier, now });
  const server = createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(), domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify',
      chainId: 84532, ttlMs: 60_000,
    }),
    createBearerAccountResolver(sessions),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, sessions,
    undefined, false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
  return `http://127.0.0.1:${address.port}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/**
 * The real entry point (server.ts) as a child process, so the deployment wiring itself is under test. `run` gets its base
 * URL; the process is stopped (and its database connections closed) before this returns, so the database can be dropped.
 */
async function withSpawnedApi(env: Record<string, string>, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiRoot,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(port), ...env },
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    await waitForListening(child);
    await run(`http://127.0.0.1:${port}`);
  } finally {
    child.kill();
    await exited;
  }
}

function waitForListening(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`API did not start: ${output}`)), 30_000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('wallet API listening')) { clearTimeout(timer); resolve(); }
    };
    child.stdout!.on('data', collect);
    child.stderr!.on('data', collect);
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`API exited: ${output}`)); });
  });
}

async function runGrantApproverCommand(databaseUrl: URL, code: string): Promise<string> {
  const command = fileURLToPath(new URL('./grant-approver-command.ts', import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', command, code], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString(), ACCOUNT_DELETION_HMAC_SECRET: secret },
    encoding: 'utf8',
  });
  return stdout.trim();
}

test('#309 the production entry point has no guest-trial route; the local showcase entry point starts a usable trial', async () => {
  await withFreshDatabase('masscom_guestprod_ci', false, async (pool, url) => withSpawnedApi({
    DATABASE_URL: url.toString(),
    GOOGLE_OAUTH_CLIENT_IDS: '123-guesttrial.apps.googleusercontent.com',
    ACCOUNT_DELETION_HMAC_SECRET: secret,
  }, async (production) => {
    const unknown = await fetch(`${production}/auth/no-such-route`, { method: 'POST' });
    const absent = await fetch(`${production}/auth/guest-trial`, { method: 'POST' });
    assert.equal(absent.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await absent.json(), await unknown.json());
    const rows = await pool.query('SELECT count(*)::int AS count FROM showcase_guest_trials');
    assert.equal(rows.rows[0].count, 0);
  }));

  await withShowcaseDatabase(async (pool, url) => withSpawnedApi({
    DATABASE_URL: url.toString(), ALLOW_INSECURE_DEMO_ACCOUNT: 'true', ACCOUNT_DELETION_HMAC_SECRET: secret,
  }, async (local) => {
    const started = await fetch(`${local}/auth/guest-trial`, { method: 'POST' });
    assert.equal(started.status, 200);
    const session = await started.json() as { sessionToken: string; accountId: string; expiresAt: string; guest: boolean };
    assert.equal(session.guest, true);
    const bearer = { authorization: `Bearer ${session.sessionToken}` };
    const mine = await fetch(`${local}/showcase/access-requests/mine`, { headers: bearer });
    assert.equal(mine.status, 200);
    const state = await mine.json() as { staff: boolean; trialMerchantId: string };
    const trial = await pool.query<{ merchant_id: string }>(
      'SELECT merchant_id FROM showcase_guest_trials WHERE account_id = $1', [session.accountId]);
    assert.equal(state.trialMerchantId, trial.rows[0]!.merchant_id);
    assert.equal(state.staff, true);
    const context = await fetch(`${local}/merchant/merchants/${state.trialMerchantId}/context`, { headers: bearer });
    assert.equal(context.status, 200);
    const merchants = await (await fetch(`${local}/merchants`)).json() as { merchants: { id: string }[] };
    assert.equal(merchants.merchants.length, 3);
    assert.ok(merchants.merchants.every((merchant) => merchant.id !== state.trialMerchantId));
  }));
});

test('#309 start creates a guest account, a hidden trial store copied from A, STAFF membership and a 24h session', async (t) => {
  await withShowcaseDatabase(async (pool) => {
    const before = Date.now();
    const guests = new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret });
    const session = await guests.start();
    assert.equal(session.guest, true);
    assert.match(session.accountId, /^acct_[0-9a-f-]{36}$/);
    const expiresAt = Date.parse(session.expiresAt);
    assert.ok(expiresAt >= before + GUEST_TRIAL_TTL_MS && expiresAt <= Date.now() + GUEST_TRIAL_TTL_MS);

    const trial = (await pool.query<{ merchant_id: string; expires_at: Date; ended_at: Date | null }>(
      'SELECT merchant_id, expires_at, ended_at FROM showcase_guest_trials WHERE account_id = $1', [session.accountId],
    )).rows[0]!;
    assert.equal(trial.ended_at, null);
    assert.equal(trial.expires_at.toISOString(), session.expiresAt);
    // Google 신원은 만들지 않는다.
    assert.equal((await pool.query('SELECT 1 FROM auth_identities WHERE account_id = $1', [session.accountId])).rowCount, 0);
    const [store, source] = (await pool.query<{ id: string; name: string; story: string; road_address: string; status: string; is_demo: boolean }>(
      `SELECT id, name, story, road_address, status, is_demo FROM merchants WHERE id IN ($1, $2)
       ORDER BY id = $1 DESC`, [trial.merchant_id, SHOWCASE_MERCHANT_ID],
    )).rows;
    assert.deepEqual(
      { name: store!.name, story: store!.story, road_address: store!.road_address, status: store!.status, is_demo: store!.is_demo },
      { name: '나의 체험 가게', story: source!.story, road_address: source!.road_address, status: 'ACTIVE', is_demo: true },
    );
    const goals = await pool.query<{ merchant_id: string; target_visit_count: number; display_name: string }>(
      `SELECT campaign.merchant_id, goal.target_visit_count, goal.display_name FROM campaign_goals goal
       JOIN campaigns campaign ON campaign.id = goal.campaign_id
       WHERE campaign.merchant_id IN ($1, $2) AND campaign.status = 'ACTIVE'
       ORDER BY goal.target_visit_count, campaign.merchant_id = $1`, [trial.merchant_id, SHOWCASE_MERCHANT_ID],
    );
    const goalsOf = (merchantId: string) => goals.rows.filter((row) => row.merchant_id === merchantId)
      .map((row) => [row.target_visit_count, row.display_name]);
    assert.deepEqual(goalsOf(trial.merchant_id), goalsOf(SHOWCASE_MERCHANT_ID));
    assert.deepEqual(goalsOf(trial.merchant_id).map(([count]) => count), [1, 3, 5]);

    // hosted 경로: 일반 Bearer 세션 해석이 체험 세션을 푼다. 최근 인증 권한은 없다.
    const sessions = new PostgresAuthSessionService(pool, { verifier: refusingVerifier });
    assert.equal(await sessions.resolve(session.sessionToken), session.accountId);
    await assert.rejects(sessions.assertRecentlyAuthenticated(session.sessionToken),
      (error: unknown) => error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED');
    // local 경로: 체험 서비스의 resolve.
    assert.equal(await guests.resolve(session.sessionToken), session.accountId);
    await assert.rejects(guests.resolve('not-a-session'),
      (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID');

    const grant = await new PostgresMerchantAccessControl(pool).requirePermission({
      accountId: session.accountId, merchantId: trial.merchant_id, permission: 'CONFIRM_VISIT',
    });
    assert.equal(grant.role, 'STAFF');

    // 체험 가게는 누구의 목록·추천에도 나오지 않는다(체험자 본인 포함).
    const listed = await new PostgresMerchantCatalog(pool).listPublicMerchants();
    assert.equal(listed.length, 3);
    assert.ok(listed.every((merchant) => merchant.id !== trial.merchant_id));
    const recommendations = new PostgresRecommendationSource(pool);
    for (const accountId of [session.accountId, 'acct_someone_else']) {
      const candidates = await recommendations.listCandidates(accountId);
      assert.equal(candidates.length, 3, accountId);
      assert.ok(candidates.every((candidate) => candidate.merchantId !== trial.merchant_id), accountId);
    }

    // 그래도 체험 가게에서 방문 확인은 된다(공개 캠페인이 필요한 경로라 is_public을 유지한 이유, D-064).
    const claims = new PostgresClaimSlotService(pool, { referenceHmacSecret: secret });
    const issued = await claims.issue({
      merchantId: trial.merchant_id, customerAccountId: 'acct_trial_customer', merchantReference: 'trial-order-1',
      createdByAccountId: session.accountId,
    });
    const redeemed = await claims.redeem({ accountId: 'acct_trial_customer', token: issued.token });
    assert.equal(redeemed.merchantId, trial.merchant_id);
    assert.equal(redeemed.visit.progressCounted, true);

    // 권한 상태: 체험자는 STAFF이고 자기 체험 가게 id를 받는다. 권한 요청은 이미 부여됨이다.
    const access = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    assert.deepEqual(await access.mine(session.accountId),
      { request: null, staff: true, approver: false, trialMerchantId: trial.merchant_id });
    assert.equal((await access.mine('acct_someone_else')).trialMerchantId, null);
    await assert.rejects(access.request(session.accountId),
      (error: unknown) => error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_ACCESS_ALREADY_GRANTED');
  });
});

test('#309 the active-guest cap holds under concurrent starts', async () => {
  await withShowcaseDatabase(async (pool) => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
      new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret, maxActive: 3 }).start()));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 3);
    for (const result of results.filter((entry) => entry.status === 'rejected')) {
      assert.ok(result.reason instanceof GuestTrialError && result.reason.code === 'GUEST_TRIAL_BUSY', String(result.reason));
    }
    const rows = await pool.query('SELECT count(*)::int AS count FROM showcase_guest_trials');
    assert.equal(rows.rows[0].count, 3);
  });
});

test('#309 an expired guest token is refused and the next start ends that guest in a bounded batch', async (t) => {
  await withShowcaseDatabase(async (pool) => {
    const clock = { now: new Date() };
    const now = () => clock.now;
    const guests = new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret, now });
    const first = await guests.start();
    // 첫 체험자가 가장 먼저 만료되도록 나머지 21명은 1초 뒤에 시작한다.
    clock.now = new Date(clock.now.getTime() + 1000);
    for (let index = 0; index < 21; index += 1) await guests.start();
    const firstMerchant = (await pool.query<{ merchant_id: string }>(
      'SELECT merchant_id FROM showcase_guest_trials WHERE account_id = $1', [first.accountId])).rows[0]!.merchant_id;
    const api = await startApiServer(t, pool, now);
    const bearer = { authorization: `Bearer ${first.sessionToken}` };
    assert.equal((await fetch(`${api}/showcase/access-requests/mine`, { headers: bearer })).status, 200);

    clock.now = new Date(clock.now.getTime() + GUEST_TRIAL_TTL_MS + 60_000);
    const expired = await fetch(`${api}/showcase/access-requests/mine`, { headers: bearer });
    assert.equal(expired.status, 401);
    assert.deepEqual(await expired.json(), { code: 'SESSION_INVALID' });
    await assert.rejects(guests.resolve(first.sessionToken),
      (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID');

    // 다음 시작이 만료된 22명 중 가장 먼저 만료된 20명만 끝낸다.
    const next = await guests.start();
    const ended = await pool.query<{ account_id: string }>(
      'SELECT account_id FROM showcase_guest_trials WHERE ended_at IS NOT NULL ORDER BY expires_at, account_id');
    assert.equal(ended.rows.length, 20);
    assert.ok(ended.rows.some((row) => row.account_id === first.accountId));
    assert.equal((await pool.query(
      'SELECT 1 FROM showcase_guest_trials WHERE ended_at IS NULL AND account_id <> $1', [next.accountId])).rowCount, 2);

    assert.equal((await pool.query('SELECT 1 FROM auth_sessions WHERE account_id = $1', [first.accountId])).rowCount, 0);
    const member = (await pool.query<{ status: string; revoked_at: Date | null }>(
      'SELECT status, revoked_at FROM merchant_members WHERE account_id = $1', [first.accountId])).rows[0]!;
    assert.equal(member.status, 'REVOKED');
    assert.ok(member.revoked_at);
    const store = (await pool.query<{ status: string }>('SELECT status FROM merchants WHERE id = $1', [firstMerchant])).rows[0]!;
    assert.equal(store.status, 'PAUSED');
    // 새 체험자는 정상이다.
    assert.equal(await guests.resolve(next.sessionToken), next.accountId);
  });
});

test('#309 a guest account can never be made an approver', async () => {
  await withShowcaseDatabase(async (pool, url) => {
    const guest = await new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret }).start();
    // 체험자는 앱에서 요청을 만들 수 없으므로(이미 STAFF) 운영자가 코드를 잘못 받은 경우를 행으로 흉내 낸다.
    await pool.query(
      `INSERT INTO showcase_access_requests (id, account_id, code) VALUES ($1, $2, 'GST7K2MQ')`,
      [randomUUID(), guest.accountId],
    );
    await assert.rejects(runGrantApproverCommand(url, 'GST7-K2MQ'));
    assert.equal((await pool.query('SELECT 1 FROM platform_admins WHERE account_id = $1', [guest.accountId])).rowCount, 0);
    assert.equal((await pool.query<{ status: string }>(
      `SELECT status FROM showcase_access_requests WHERE code = 'GST7K2MQ'`)).rows[0]!.status, 'PENDING');
  });
});

test('#309 AI art is refused for a trial store before any OpenAI call or budget row', async () => {
  await withShowcaseDatabase(async (pool) => {
    const guest = await new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret }).start();
    const merchantId = (await pool.query<{ merchant_id: string }>(
      'SELECT merchant_id FROM showcase_guest_trials WHERE account_id = $1', [guest.accountId])).rows[0]!.merchant_id;
    const fake = fakeOpenAiFetch();
    const art = new PostgresMerchantArtService(pool, {
      client: new OpenAiImageClient({
        apiKey: 'test-only-openai-key', baseUrl: 'http://127.0.0.1:9', draftModel: 'draft-model', finalModel: 'final-model',
        fetch: fake.fetch, sleep: async () => {}, random: () => 0, log: () => {},
      }),
      config: resolveAiArtConfig({}),
      staffMayManageArt: true,
    });
    const refused = (error: unknown) => error instanceof MerchantArtError && error.code === 'AI_ART_TRIAL_DISABLED';
    await assert.rejects(art.createRound({ merchantId, accountId: guest.accountId }), refused);
    await assert.rejects(art.chooseDraft({ merchantId, roundId: randomUUID(), index: 0, accountId: guest.accountId }), refused);
    await art.drain();
    assert.equal(fake.calls.length, 0);
    assert.equal((await pool.query('SELECT 1 FROM ai_art_spend')).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM merchant_art_rounds')).rowCount, 0);
  });
});

test('#309 the guest-trial service refuses a database that is not a showcase database', async () => {
  await withFreshDatabase('masscom_guestprod_ci', false, async (pool) => {
    const guests = new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret: secret });
    const refused = (error: unknown) =>
      error instanceof GuestTrialError && error.code === 'SHOWCASE_HOST_DATABASE_REQUIRED';
    await assert.rejects(guests.start(), refused);
    await assert.rejects(guests.resolve('any-token'), refused);
    assert.equal((await pool.query('SELECT 1 FROM showcase_guest_trials')).rowCount, 0);
    assert.equal((await pool.query(`SELECT 1 FROM merchants WHERE id LIKE 'trial-%'`)).rowCount, 0);
  });
});
