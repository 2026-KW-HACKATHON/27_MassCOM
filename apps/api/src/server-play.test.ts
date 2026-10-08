import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import type { Pool, PoolClient } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { defaultStudio, type PlayService } from './play.js';
import type { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresPlayService } from './postgres/play.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

// Exercise the HTTP handler with Node request/response streams, without opening a listening socket.
async function request(server: Server, method: string, url: string, accountId?: string, body?: string,
  headers: Record<string, string> = {}) {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method;
  incoming.url = url;
  incoming.httpVersion = '1.0';
  incoming.headers = { 'content-type': 'application/json', ...(accountId ? { 'x-account-id': accountId } : {}), ...headers };
  if (body !== undefined) incoming.push(body);
  incoming.push(null);
  const response = new ServerResponse(incoming);
  const transport = new PassThrough();
  const chunks: Buffer[] = [];
  transport.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.assignSocket(transport as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
    server.emit('request', incoming, response);
  });
  const payload = Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]!;
  return { status: response.statusCode, headers: response.getHeaders(),
    body: payload ? JSON.parse(payload) as unknown : undefined, bodyRead: incoming.readableDidRead };
}

function fixture(consent?: ConsentService, configure?: (args: Parameters<typeof createApiServer>) => void) {
  const calls: string[] = [];
  const snapshot = { studio: defaultStudio, revision: 0, records: [], unlockedThemes: [], items: [],
    coinItems: [], furnitureItems: [], avatar: null };
  const play: PlayService = {
    start: async ({ accountId, kind }) => {
      calls.push(`start:${accountId}`);
      return { id: '00000000-0000-4000-8000-000000000001', kind, seed: 1, rulesVersion: 1,
        startedAt: '2026-10-04T00:00:00Z', expiresAt: '2026-10-04T00:00:45Z', durationMs: 30000 };
    },
    finish: async ({ accountId }) => {
      calls.push(`finish:${accountId}`);
      return { kind: 'orders', score: 1200, completed: true, correct: 12, total: 12,
        bestScore: 1200, plays: 1, unlockedThemes: [] };
    },
    getPlay: async (accountId) => { calls.push(`play:${accountId}`); return snapshot; },
    getStudio: async (accountId) => { calls.push(`studio:${accountId}`); return snapshot; },
    saveStudio: async ({ accountId }) => { calls.push(`save:${accountId}`); return snapshot; },
    getFriendStudio: async ({ accountId }) => {
      calls.push(`friend:${accountId}`);
      return { nickname: 'Friend', studio: defaultStudio, items: [], avatar: null };
    },
    recordEvent: async ({ accountId }) => { calls.push(`event:${accountId}`); },
    aggregate: async (days) => ({ days, events: [], games: [] }),
  };
  const challenge = new WalletChallengeService({ store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify', chainId: 84532,
    ttlMs: 300000, nonce: () => 'abc12345def67890', challengeId: () => 'challenge-http-play' });
  const args: Parameters<typeof createApiServer> = [challenge, developmentHeaderAccountResolver];
  args[26] = consent;
  args[37] = play;
  configure?.(args);
  return { server: createApiServer(...args), calls };
}

function consentFixture(): ConsentService {
  const versions = new Map([
    ['old', 'privacy-2026-09-30'], ['current', CURRENT_PRIVACY_VERSION], ['other', CURRENT_PRIVACY_VERSION],
  ]);
  return { appSource: 'ANDROID',
    status: async (accountId) => ({ required: versions.get(accountId) !== CURRENT_PRIVACY_VERSION,
      termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }),
    record: async () => { throw new Error('consent must never be recorded implicitly'); },
  };
}

test('play start negotiates legacy 1 for old bodies and explicit version 2 for new clients', async () => {
  const inputs: unknown[] = [];
  const { server } = fixture(consentFixture(), args => {
    args[37] = { ...args[37]!, start: async input => {
      inputs.push(input);
      return { id: '00000000-0000-4000-8000-000000000001', kind: input.kind, seed: 17,
        rulesVersion: (input as { rulesVersion?: 1 | 2 }).rulesVersion ?? 2,
        startedAt: '2026-10-05T00:00:00Z', expiresAt: '2026-10-05T00:00:45Z', durationMs: 30000 };
    } };
  });
  for (const [body, version] of [
    [{ kind: 'orders' }, 1], [{ kind: 'orders', rulesVersion: 2 }, 2],
    [{ rulesVersion: 1, kind: 'orders' }, 1],
  ] as const) {
    const response = await request(server, 'POST', '/me/play/runs', 'current', JSON.stringify(body));
    assert.equal(response.status, 201);
    assert.equal((response.body as { rulesVersion: number }).rulesVersion, version);
    assert.deepEqual(inputs.at(-1), { accountId: 'current', kind: 'orders', rulesVersion: version });
  }
  for (const body of [
    ...[0, 3, 1.5, '2', null, false].map(rulesVersion => ({ kind: 'orders', rulesVersion })),
    { kind: 'orders', rulesVersion: 2, score: 999 }, { rulesVersion: 2 }, { kind: 'invented', rulesVersion: 2 },
  ]) {
    assert.equal((await request(server, 'POST', '/me/play/runs', 'current', JSON.stringify(body))).status, 400);
  }
  assert.equal(inputs.length, 3, 'invalid negotiation must not reach the play service');
});

const routes = [
  ['GET', '/me/play', undefined, 200],
  ['POST', '/me/play/runs', JSON.stringify({ kind: 'orders' }), 201],
  ['POST', '/me/play/runs/00000000-0000-4000-8000-000000000001/finish', JSON.stringify({ actions: [] }), 200],
  ['POST', '/me/play/events', JSON.stringify({ event: 'share-open' }), 204],
  ['GET', '/me/studio', undefined, 200],
  ['PUT', '/me/studio', JSON.stringify({ studio: defaultStudio }), 200],
  ['GET', '/friends/friendship-1/studio', undefined, 200],
] as const;

for (const [method, url, body, success] of routes) {
  test(`놀이·공간 ${method} ${url}는 현재 동의 전에 데이터에 접근하지 않는다`, { timeout: 5000 }, async () => {
    const { server, calls } = fixture(consentFixture());
    assert.equal((await request(server, method, url, undefined, body)).status, 401);
    for (const account of ['none', 'old']) {
      const denied = await request(server, method, url, account, body);
      assert.equal(denied.status, 403);
      assert.deepEqual(denied.body, { code: 'CONSENT_REQUIRED' });
      assert.equal(denied.bodyRead, false);
    }
    assert.deepEqual(calls, []);
    assert.equal((await request(server, method, url, 'current', body)).status, success);
    assert.equal(calls.length, 1);
  });
}

test('놀이·공간은 동의 서비스가 없으면 닫힌다', { timeout: 5000 }, async () => {
  const { server, calls } = fixture();
  for (const [method, url, body] of routes) {
    const denied = await request(server, method, url, 'current', body);
    assert.equal(denied.status, 503);
    assert.deepEqual(denied.body, { code: 'CONSENT_NOT_CONFIGURED' });
    assert.equal(denied.bodyRead, false);
  }
  assert.deepEqual(calls, []);
});

test('완료 재시도는 계정별 분당 60회 허용하고 초과 본문·서비스 처리를 막는다', { timeout: 5000 }, async () => {
  const consent = consentFixture();
  const status = consent.status;
  let consentReads = 0;
  consent.status = async (accountId) => { consentReads++; return status(accountId); };
  const { server, calls } = fixture(consent);
  const url = '/me/play/runs/00000000-0000-4000-8000-000000000001/finish';
  let first: unknown;
  for (let count = 0; count < 60; count++) {
    const retry = await request(server, 'POST', url, 'current', '{"actions":[]}');
    assert.equal(retry.status, 200);
    if (count === 0) first = retry.body;
    else assert.deepEqual(retry.body, first);
  }
  const denied = await request(server, 'POST', '/me/play/runs/different-run/finish', 'current', 'invalid JSON');
  assert.equal(denied.status, 429);
  assert.deepEqual(denied.body, { code: 'PLAY_FLOW_RATE_LIMITED' });
  assert.ok(Number(denied.headers['retry-after']) > 0);
  assert.equal(denied.bodyRead, false);
  assert.equal(calls.length, 60);
  assert.equal(consentReads, 60, 'rate limited requests must not query consent or play data');
  assert.equal((await request(server, 'POST', url, 'other', '{"actions":[]}')).status, 200);
});

test('시작은 계정별 시간당 30회 이후 PLAY_RATE_LIMITED를 반환한다', { timeout: 5000 }, async () => {
  let inserted = 0;
  const client = {
    query: async (sql: string) => {
      if (sql.includes('SELECT count(*)::integer AS count FROM play_runs')) {
        return { rows: [{ count: inserted }], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO play_runs')) inserted++;
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  } as unknown as PoolClient;
  const pool = { connect: async () => client } as unknown as Pool;
  const lifecycle = { assertActive: async () => {} } as unknown as PostgresAccountLifecycle;
  const play = new PostgresPlayService(pool, lifecycle, { now: () => new Date('2026-10-04T00:00:00Z') });
  const { server } = fixture(consentFixture(), (args) => { args[37] = play; });
  for (let count = 0; count < 30; count++) {
    assert.equal((await request(server, 'POST', '/me/play/runs', 'current', '{"kind":"orders"}')).status, 201);
  }
  const denied = await request(server, 'POST', '/me/play/runs', 'current', '{"kind":"orders"}');
  assert.equal(denied.status, 429);
  assert.deepEqual(denied.body, { code: 'PLAY_RATE_LIMITED' });
  assert.equal(inserted, 30);
});

test('놀이 지표는 웹 관리자 세션과 권한이 있어야 조회된다', { timeout: 5000 }, async () => {
  let aggregates = 0;
  let allowed = false;
  const { server } = fixture(consentFixture(), (args) => {
    args[14] = {
      start: async () => { throw new Error('unused'); },
      complete: async () => { throw new Error('unused'); },
      resolveSession: async () => 'viewer',
      resolveSessionWithAge: async () => ({ accountId: 'viewer', ageMs: 0 }),
      logout: async () => {},
    };
    args[17] = { isAdmin: async () => allowed } as unknown as NonNullable<Parameters<typeof createApiServer>[17]>;
    args[37] = { ...args[37]!, aggregate: async (days) => {
      aggregates++;
      return { days, events: [], games: [] };
    } };
  });
  const path = '/api/web/admin/play/metrics';
  const host = { host: 'masscom.kr' };
  assert.equal((await request(server, 'GET', path, undefined, undefined, host)).status, 401);
  const denied = await request(server, 'GET', path, undefined, undefined,
    { ...host, cookie: 'web_session=valid' });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { code: 'ADMIN_FORBIDDEN' });
  assert.equal(aggregates, 0);
  allowed = true;
  const approved = await request(server, 'GET', `${path}?days=7`, undefined, undefined,
    { ...host, cookie: 'web_session=valid' });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body, { days: 7, events: [], games: [] });
  assert.equal(aggregates, 1);
});
