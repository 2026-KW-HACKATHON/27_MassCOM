import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exchangeGoogleCode, resolveWebAuthConfig } from './web-auth.js';

test('web OAuth is disabled without a full credential tuple and rejects partial configuration', () => {
  assert.equal(resolveWebAuthConfig({}), undefined);
  assert.throws(() => resolveWebAuthConfig({ GOOGLE_WEB_CLIENT_ID: '123.apps.googleusercontent.com' }),
    /WEB_AUTH_CONFIGURATION_INVALID/);
  assert.throws(() => resolveWebAuthConfig({
    GOOGLE_WEB_CLIENT_ID: '123.apps.googleusercontent.com',
    GOOGLE_WEB_CLIENT_SECRET: 'test-only-secret',
    GOOGLE_WEB_REDIRECT_URI: 'https://other.example/api/web/auth/callback',
  }), /WEB_AUTH_CONFIGURATION_INVALID/);
});

test('web OAuth accepts only the operating-domain callback configuration', () => {
  assert.deepEqual(resolveWebAuthConfig({
    GOOGLE_WEB_CLIENT_ID: '123.apps.googleusercontent.com',
    GOOGLE_WEB_CLIENT_SECRET: 'test-only-secret',
    GOOGLE_WEB_REDIRECT_URI: 'https://masscom.kr/api/web/auth/callback',
  }), {
    clientId: '123.apps.googleusercontent.com',
    webCredential: 'test-only-secret',
    redirectUri: 'https://masscom.kr/api/web/auth/callback',
  });
});

const exchangeInput = {
  clientId: '123.apps.googleusercontent.com',
  webCredential: 'test-only-credential',
  redirectUri: 'https://masscom.kr/api/web/auth/callback',
  code: 'one-use-code',
  verifier: 'v'.repeat(43),
};

test('Google code exchange sends the fixed redirect and PKCE verifier and returns only the ID token', async () => {
  const token = await exchangeGoogleCode(exchangeInput, async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.method, 'POST');
    assert.ok(options.body instanceof URLSearchParams);
    const body = options.body;
    assert.equal(body.get('code'), 'one-use-code');
    assert.equal(body.get('code_verifier'), 'v'.repeat(43));
    assert.equal(body.get('redirect_uri'), 'https://masscom.kr/api/web/auth/callback');
    assert.equal(body.get('grant_type'), 'authorization_code');
    return new Response(JSON.stringify({ id_token: 'signed-token', access_token: 'do-not-return' }), { status: 200 });
  });
  assert.equal(token, 'signed-token');
});

test('Google transport, upstream 5xx, and malformed body remain temporary failures, not invalid codes', async () => {
  for (const fetcher of [
    async () => { throw new Error('network offline'); },
    async () => { throw new DOMException('timed out', 'TimeoutError'); },
    async () => new Response('{}', { status: 503 }),
    async () => new Response('not-json', { status: 200 }),
    async () => new Response('{}', { status: 200 }),
    async () => new Response('{"error":"temporarily_unavailable"}', { status: 400 }),
  ]) {
    await assert.rejects(exchangeGoogleCode(exchangeInput, fetcher), /WEB_AUTH_UPSTREAM_UNAVAILABLE/);
  }
});

test('only Google invalid_grant maps to a rejected one-use code', async () => {
  await assert.rejects(exchangeGoogleCode(exchangeInput, async () =>
    new Response('{"error":"invalid_grant"}', { status: 400 })), /WEB_AUTH_CODE_INVALID/);
});
