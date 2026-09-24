import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveWebAuthConfig } from './web-auth.js';

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
