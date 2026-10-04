import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayApiClient, playErrorMessage, PlayApiError } from './play-api';
import { finalizeDeliveryActions } from './run-actions';

const credential = { kind: 'bearer', sessionToken: 'test-session' } as const;
const run = { id: 'run-1', kind: 'stack', seed: 123, startedAt: '2026-10-04T00:00:00.000Z', expiresAt: '2026-10-04T00:01:00.000Z', durationMs: 30000, rulesVersion: 1 } as const;

test('play client scopes reads, start and finish to bearer account and sends only action log', async () => {
  const calls: { path: string; body: unknown; auth: string | null }[] = [];
  const responses = [
    { records: [{ kind: 'stack', bestScore: 70, plays: 2 }], unlockedThemes: ['garden'] },
    run,
    { kind: 'stack', score: 80, bestScore: 80, plays: 3, completed: true, correct: 8, total: 8, unlockedThemes: ['garden'] },
  ];
  const api = createPlayApiClient({ apiUrl: 'https://api.test/', credential, fetcher: async (url, init) => {
    calls.push({ path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get('authorization') });
    return Response.json(responses.shift());
  } });
  assert.equal((await api.getPlay()).records[0]?.bestScore, 70);
  assert.equal((await api.start('stack')).id, 'run-1');
  assert.equal((await api.finish(run, [{ at: 42, choice: 2 }])).score, 80);
  assert.deepEqual(calls.map((call) => call.auth), ['Bearer test-session', 'Bearer test-session', 'Bearer test-session']);
  assert.deepEqual(calls[2]?.body, { actions: [{ at: 42, choice: 2 }] });
});

test('network errors retain retryable finish semantics', async () => {
  const api = createPlayApiClient({ apiUrl: 'https://api.test', credential, fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(() => api.finish(run, []), (error) => error instanceof PlayApiError && error.code === 'NETWORK_ERROR');
});

test('play retains 403 CONSENT_REQUIRED and explains re-consent in Korean', async () => {
  const api = createPlayApiClient({ apiUrl: 'https://api.test', credential,
    fetcher: async () => Response.json({ code: 'CONSENT_REQUIRED' }, { status: 403 }) });
  await assert.rejects(() => api.getPlay(), (error) => error instanceof PlayApiError
    && error.status === 403 && error.code === 'CONSENT_REQUIRED'
    && playErrorMessage(error) === '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.');
});

test('start rejects seeds outside the game board range as invalid responses', async () => {
  for (const seed of [0, 0x7fffffff, -1, 0x80000000, 1.5]) {
    const api = createPlayApiClient({ apiUrl: 'https://api.test', credential, fetcher: async () => Response.json({ ...run, seed }) });
    if (seed >= 0 && seed <= 0x7fffffff && Number.isInteger(seed)) assert.equal((await api.start('stack')).seed, seed);
    else await assert.rejects(() => api.start('stack'), (error) => error instanceof PlayApiError && error.code === 'INVALID_RESPONSE');
  }
});

test('retrying a lost finish response resends the same run and actions', async () => {
  const requests: { url: string; body: string }[] = [];
  const api = createPlayApiClient({ apiUrl: 'https://api.test', credential, fetcher: async (url, init) => {
    requests.push({ url: String(url), body: String(init?.body) });
    if (requests.length === 1) throw new Error('response lost');
    return Response.json({ kind: 'stack', score: 50, bestScore: 50, plays: 1, completed: true, correct: 1, total: 6, unlockedThemes: ['daylight'] });
  } });
  const actions = [{ at: 42, choice: 0 }];
  await assert.rejects(() => api.finish(run, actions), PlayApiError);
  await api.finish(run, actions);
  assert.deepEqual(requests[0], requests[1]);
});


test('배달 종료 응답이 유실돼도 확정한 종료 시각과 lane을 그대로 다시 전송한다', async () => {
  const bodies: string[] = [];
  const delivery = { ...run, kind: 'delivery' } as const;
  const log = finalizeDeliveryActions([], 1, 2_500, delivery.durationMs);
  const api = createPlayApiClient({ apiUrl: 'https://api.test', credential, fetcher: async (_url, init) => {
    bodies.push(String(init?.body));
    if (bodies.length === 1) throw new Error('응답 유실');
    return Response.json({ kind: 'delivery', score: 100, bestScore: 100, plays: 0, completed: false,
      correct: 1, total: 12, unlockedThemes: ['daylight'] });
  } });
  await assert.rejects(() => api.finish(delivery, log), PlayApiError);
  await api.finish(delivery, log);
  assert.deepEqual(bodies, [JSON.stringify({ actions: [{ at: 2_500, choice: 1 }] }),
    JSON.stringify({ actions: [{ at: 2_500, choice: 1 }] })]);
});
