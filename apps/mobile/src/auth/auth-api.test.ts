import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthApiClient, AuthApiError } from './auth-api';

test('exchanges a Google ID token for one validated server session', async () => {
  let receivedHeaders: Headers | undefined;
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test/',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/auth/google');
      assert.equal(init?.method, 'POST');
      receivedHeaders = new Headers(init?.headers);
      assert.deepEqual(JSON.parse(String(init?.body)), { idToken: 'google-id-token' });
      return Response.json({
        sessionToken: 'server-session',
        accountId: 'account-1',
        expiresAt: '2026-10-21T00:00:00.000Z',
      });
    },
  });

  assert.deepEqual(await client.signIn('google-id-token'), {
    version: 1,
    sessionToken: 'server-session',
    accountId: 'account-1',
    expiresAt: '2026-10-21T00:00:00.000Z',
  });
  assert.equal(receivedHeaders?.get('content-type'), 'application/json');
  assert.equal(receivedHeaders?.has('authorization'), false);
});

test('maps login errors without retaining or echoing the Google ID token', async () => {
  const idToken = 'secret-google-id-token';
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    fetcher: async () => Response.json(
      { code: 'GOOGLE_ID_TOKEN_INVALID', detail: idToken },
      { status: 401 },
    ),
  });

  await assert.rejects(client.signIn(idToken), (error) =>
    error instanceof AuthApiError
    && error.status === 401
    && error.code === 'GOOGLE_ID_TOKEN_INVALID'
    && !error.message.includes(idToken));
});

test('starts a guest trial without any token and returns one validated server session', async () => {
  let receivedHeaders: Headers | undefined;
  let receivedBody: string | undefined;
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test/',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/auth/guest-trial');
      assert.equal(init?.method, 'POST');
      receivedHeaders = new Headers(init?.headers);
      receivedBody = String(init?.body);
      return Response.json({
        sessionToken: 'guest-session',
        accountId: 'guest-account',
        expiresAt: '2026-10-21T00:00:00.000Z',
        guest: true,
      }, { status: 201 });
    },
  });

  assert.deepEqual(await client.startGuestTrial(), {
    version: 1,
    sessionToken: 'guest-session',
    accountId: 'guest-account',
    expiresAt: '2026-10-21T00:00:00.000Z',
    guest: true,
  });
  assert.equal(receivedBody, '{}');
  assert.equal(receivedHeaders?.get('content-type'), 'application/json');
  assert.equal(receivedHeaders?.has('authorization'), false);
});

test('surfaces the guest trial rate limit and capacity errors by status', async () => {
  const rateLimited = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    fetcher: async () => Response.json({ code: 'HTTP_429' }, { status: 429 }),
  });
  await assert.rejects(rateLimited.startGuestTrial(), (error) =>
    error instanceof AuthApiError && error.status === 429);

  const busy = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    fetcher: async () => Response.json({ code: 'GUEST_TRIAL_BUSY' }, { status: 503 }),
  });
  await assert.rejects(busy.startGuestTrial(), (error) =>
    error instanceof AuthApiError && error.status === 503 && error.code === 'GUEST_TRIAL_BUSY');
});

test('the default fetcher works called as this.#fetcher(...), not just as a bare function (#309 web)', async () => {
  // A real browser's native fetch brand-checks its receiver and throws "Illegal invocation" unless
  // bound to window first; Node's fetch never checks this, so a mocked fetcher in other tests here
  // would never catch a regression. This replaces the global to reproduce that browser check.
  const originalFetch = globalThis.fetch;
  function brandCheckedFetch(this: unknown) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(Response.json({
      sessionToken: 'guest-session', accountId: 'guest-account', expiresAt: '2026-10-21T00:00:00.000Z',
    }));
  }
  globalThis.fetch = brandCheckedFetch as typeof fetch;
  try {
    const client = new AuthApiClient({ apiUrl: 'https://api.example.test' });
    assert.equal((await client.startGuestTrial()).sessionToken, 'guest-session');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects a malformed successful session response', async () => {
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    fetcher: async () => Response.json({ sessionToken: '', accountId: 'account-1', expiresAt: 'bad' }),
  });
  await assert.rejects(
    client.signIn('google-id-token'),
    (error) => error instanceof AuthApiError && error.code === 'INVALID_RESPONSE',
  );
});

test('logs out with the server Bearer session only', async () => {
  let receivedHeaders: Headers | undefined;
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/auth/logout');
      assert.equal(init?.method, 'POST');
      receivedHeaders = new Headers(init?.headers);
      return Response.json({ status: 'LOGGED_OUT' });
    },
  });

  await client.logout('server-session');
  assert.equal(receivedHeaders?.get('authorization'), 'Bearer server-session');
  assert.equal(receivedHeaders?.has('x-account-id'), false);
});

test('times out a stalled request and aborts its fetch', async () => {
  let signal: AbortSignal | undefined;
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    timeoutMs: 10,
    fetcher: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    },
  });

  await assert.rejects(client.signIn('google-id-token'), (error) =>
    error instanceof AuthApiError && error.status === 0 && error.code === 'REQUEST_TIMEOUT');
  assert.equal(signal?.aborted, true);
});

test('times out when the response body stalls', async () => {
  let signal: AbortSignal | undefined;
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    timeoutMs: 10,
    fetcher: async (_input, init) => {
      signal = init?.signal ?? undefined;
      return {
        status: 200,
        ok: true,
        json: async () => new Promise<unknown>(() => undefined),
      } as Response;
    },
  });

  await assert.rejects(client.signIn('google-id-token'), (error) =>
    error instanceof AuthApiError && error.status === 0 && error.code === 'REQUEST_TIMEOUT');
  assert.equal(signal?.aborted, true);
});

test('keeps network failures distinct from timeouts', async () => {
  const client = new AuthApiClient({
    apiUrl: 'https://api.example.test',
    timeoutMs: 10,
    fetcher: async () => { throw new Error('offline'); },
  });

  await assert.rejects(client.signIn('google-id-token'), (error) =>
    error instanceof AuthApiError && error.status === 0 && error.code === 'NETWORK_ERROR');
});
