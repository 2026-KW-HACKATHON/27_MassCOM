import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVisitorFeedbackApiClient, parseSelection, VisitorFeedbackApiError } from './visitor-feedback-api';

const empty = { tags: [], suggestions: [], note: null };
const credential = { kind: 'bearer', sessionToken: 'test-token' } as const;

test('GET and PUT use the authenticated JSON contract and return the caller selection', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const client = createVisitorFeedbackApiClient({
    apiUrl: 'https://api.example.test/', credential,
    fetcher: async (input, init) => {
      seen.push({ url: String(input), init: init! });
      return Response.json(empty);
    },
  });
  assert.deepEqual(await client.getMine('shop 1'), empty);
  assert.deepEqual(await client.save('shop 1', empty), empty);
  assert.deepEqual(seen.map(({ url }) => url), [
    'https://api.example.test/me/merchant-feedback/shop%201',
    'https://api.example.test/me/merchant-feedback/shop%201',
  ]);
  assert.equal(new Headers(seen[0]!.init.headers).get('authorization'), 'Bearer test-token');
  assert.equal(new Headers(seen[0]!.init.headers).get('accept'), 'application/json');
  assert.equal(seen[1]!.init.method, 'PUT');
  assert.equal(new Headers(seen[1]!.init.headers).get('content-type'), 'application/json');
  assert.equal(seen[1]!.init.body, JSON.stringify(empty));
});

test('maps eligibility, invalid selection, rejected note, and rate limit to typed errors', async () => {
  const cases = [
    [403, 'VISITOR_FEEDBACK_NOT_ELIGIBLE', 'NOT_ELIGIBLE'],
    [400, 'VISITOR_FEEDBACK_TAGS_INVALID', 'INVALID'],
    [400, 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID', 'INVALID'],
    [400, 'VISITOR_FEEDBACK_NOTE_INVALID', 'NOTE_REJECTED'],
    [429, 'VISITOR_FEEDBACK_RATE_LIMITED', 'RATE_LIMITED'],
  ] as const;
  for (const [status, serverCode, expectedCode] of cases) {
    const client = createVisitorFeedbackApiClient({
      apiUrl: 'https://api.example.test', credential,
      fetcher: async () => Response.json({ code: serverCode }, { status }),
    });
    await assert.rejects(client.save('shop', empty), (error: unknown) => {
      assert.ok(error instanceof VisitorFeedbackApiError);
      assert.equal(error.code, expectedCode);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('maps transport failures to NETWORK and rejects malformed success payloads', async () => {
  const offline = createVisitorFeedbackApiClient({ apiUrl: 'https://api.example.test', credential, fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.getMine('shop'), (error: unknown) => error instanceof VisitorFeedbackApiError && error.code === 'NETWORK');
  for (const payload of [
    {}, { ...empty, tags: ['UNKNOWN'] }, { ...empty, tags: ['SOLO', 'SOLO'] },
    { ...empty, suggestions: ['SOLO_MENU', 'SPICE_LABEL', 'MORE_PHOTOS'] },
    { ...empty, note: 5 },
  ]) {
    assert.throws(() => parseSelection(payload), (error: unknown) => error instanceof VisitorFeedbackApiError && error.code === 'INVALID');
  }
});

test('calls the session invalidation hook for an expired bearer session', async () => {
  let invalidations = 0;
  const client = createVisitorFeedbackApiClient({
    apiUrl: 'https://api.example.test', credential,
    onSessionInvalid: () => { invalidations += 1; },
    fetcher: async () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 }),
  });
  await assert.rejects(client.getMine('shop'), VisitorFeedbackApiError);
  assert.equal(invalidations, 1);
});

test('optional feedback GET and PUT return typed 401 errors without a session callback', async () => {
  const requests: string[] = [];
  const client = createVisitorFeedbackApiClient({
    apiUrl: 'https://api.example.test', credential,
    fetcher: async (_input, init) => {
      requests.push(init?.method ?? 'GET');
      return Response.json({ code: 'SESSION_INVALID' }, { status: 401 });
    },
  });
  for (const request of [client.getMine('shop'), client.save('shop', empty)]) {
    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof VisitorFeedbackApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 'INVALID');
      return true;
    });
  }
  assert.deepEqual(requests, ['GET', 'PUT']);
});
