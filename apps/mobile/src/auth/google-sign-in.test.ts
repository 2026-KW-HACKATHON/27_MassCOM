import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createGoogleSignInAdapter,
  GoogleSignInAdapterError,
  type NitroGoogleSurface,
} from './google-sign-in';

function fakeSurface(overrides: Partial<NitroGoogleSurface> = {}): NitroGoogleSurface {
  return {
    configure() {},
    async signIn() {
      return { type: 'success', data: { idToken: 'google-id-token' } };
    },
    async createAccount() {
      return { type: 'success', data: { idToken: 'created-google-id-token' } };
    },
    async signOut() {},
    ...overrides,
  };
}

test('configures once with a trimmed Web client ID and no offline access', () => {
  const calls: unknown[] = [];
  const adapter = createGoogleSignInAdapter(fakeSurface({
    configure(options) {
      calls.push(options);
    },
  }));

  adapter.configure(' web-client.apps.googleusercontent.com ');
  adapter.configure('web-client.apps.googleusercontent.com');
  assert.deepEqual(calls, [{
    webClientId: 'web-client.apps.googleusercontent.com',
    offlineAccess: false,
  }]);
});

test('returns the ID token from the native success response', async () => {
  const adapter = createGoogleSignInAdapter(fakeSurface());
  adapter.configure('web-client');
  assert.deepEqual(await adapter.signIn(), { idToken: 'google-id-token' });
});

test('prefers the explicit Google button flow when the native surface provides it', async () => {
  let explicitCalls = 0;
  let credentialManagerCalls = 0;
  const surface = fakeSurface({
    async signIn() {
      credentialManagerCalls += 1;
      return { type: 'success', data: { idToken: 'credential-manager-token' } };
    },
  }) as NitroGoogleSurface & {
    presentExplicitSignIn(): Promise<{ type: 'success'; data: { idToken: string } }>;
  };
  surface.presentExplicitSignIn = async () => {
    explicitCalls += 1;
    return { type: 'success', data: { idToken: 'explicit-button-token' } };
  };

  const adapter = createGoogleSignInAdapter(surface);
  adapter.configure('web-client');

  assert.deepEqual(await adapter.signIn(), { idToken: 'explicit-button-token' });
  assert.equal(explicitCalls, 1);
  assert.equal(credentialManagerCalls, 0);
});

test('uses createAccount only when no saved credential exists', async () => {
  let createCalls = 0;
  const adapter = createGoogleSignInAdapter(fakeSurface({
    async signIn() {
      return { type: 'noSavedCredentialFound' };
    },
    async createAccount() {
      createCalls += 1;
      return { type: 'success', data: { idToken: 'first-login-token' } };
    },
  }));
  adapter.configure('web-client');
  assert.deepEqual(await adapter.signIn(), { idToken: 'first-login-token' });
  assert.equal(createCalls, 1);
});

test('maps cancellation and missing tokens to fixed safe codes', async () => {
  const cancelled = createGoogleSignInAdapter(fakeSurface({
    async signIn() {
      return { type: 'cancelled' };
    },
  }));
  cancelled.configure('web-client');
  await assert.rejects(
    cancelled.signIn(),
    (error) => error instanceof GoogleSignInAdapterError && error.code === 'GOOGLE_SIGN_IN_CANCELLED',
  );

  const missing = createGoogleSignInAdapter(fakeSurface({
    async signIn() {
      return { type: 'success', data: { idToken: null } };
    },
  }));
  missing.configure('web-client');
  await assert.rejects(
    missing.signIn(),
    (error) => error instanceof GoogleSignInAdapterError && error.code === 'GOOGLE_ID_TOKEN_MISSING',
  );
});

test('maps thrown native cancellation without exposing the native message', async () => {
  const adapter = createGoogleSignInAdapter(fakeSurface({
    async signIn() {
      throw { code: 'SIGN_IN_CANCELLED', message: 'secret native account detail' };
    },
  }));
  adapter.configure('web-client');
  await assert.rejects(adapter.signIn(), (error) =>
    error instanceof GoogleSignInAdapterError
    && error.code === 'GOOGLE_SIGN_IN_CANCELLED'
    && !error.message.includes('secret native account detail'));
});

test('forwards sign out to the native surface', async () => {
  let calls = 0;
  const adapter = createGoogleSignInAdapter(fakeSurface({
    async signOut() {
      calls += 1;
    },
  }));
  await adapter.signOut();
  assert.equal(calls, 1);
});
