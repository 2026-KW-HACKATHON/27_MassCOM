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
