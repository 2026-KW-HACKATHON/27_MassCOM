import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAuthController, type AuthControllerDependencies, type AuthState } from './auth-controller';
import { GoogleSignInAdapterError } from './google-sign-in';
import { AuthStorageError, type StoredAuthSessionV1 } from './session-store';

const oldSession: StoredAuthSessionV1 = {
  version: 1,
  sessionToken: 'old-session',
  accountId: 'old-account',
  expiresAt: '2026-10-21T00:00:00.000Z',
};
const newSession: StoredAuthSessionV1 = {
  version: 1,
  sessionToken: 'new-session',
  accountId: 'new-account',
  expiresAt: '2026-10-21T01:00:00.000Z',
};

function fixture(overrides: Partial<AuthControllerDependencies> = {}) {
  const calls: string[] = [];
  const states: AuthState[] = [];
  let stored: StoredAuthSessionV1 | undefined = oldSession;
  const dependencies: AuthControllerDependencies = {
    sessionStore: {
      async load() {
        calls.push('store.load');
        return stored;
      },
      async save(session) {
        calls.push(`store.save:${session.accountId}`);
        stored = session;
      },
      async clear() {
        calls.push('store.clear');
        stored = undefined;
      },
    },
    authApi: {
      async signIn() {
        calls.push('api.signIn');
        return newSession;
      },
      async logout(token) {
        calls.push(`api.logout:${token}`);
      },
    },
    google: {
      async signIn() {
        calls.push('google.signIn');
        return { idToken: 'google-id-token' };
      },
      async signOut() {
        calls.push('google.signOut');
      },
    },
    async clearWalletSession() {
      calls.push('wallet.clear');
    },
    publish(state) {
      states.push(state);
    },
    ...overrides,
  };
  return {
    calls,
    states,
    dependencies,
    stored: () => stored,
    setStored(session: StoredAuthSessionV1 | undefined) {
      stored = session;
    },
  };
}

test('restores a valid session as one bearer credential', async () => {
  const f = fixture();
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  assert.deepEqual(controller.getState(), {
    status: 'signedIn',
    session: oldSession,
    credential: { kind: 'bearer', sessionToken: 'old-session' },
  });
  assert.deepEqual(f.calls, ['store.load']);
});

test('fails closed to signed out when secure storage cannot be read', async () => {
  const f = fixture({
    sessionStore: {
      async load() {
        throw new AuthStorageError('READ_FAILED');
      },
      async save() {},
      async clear() {},
    },
  });
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  assert.deepEqual(controller.getState(), {
    status: 'signedOut',
    reason: 'SECURE_STORAGE_UNAVAILABLE',
  });
});

test('orders Google sign in, server exchange, and secure storage save', async () => {
  const f = fixture();
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);
  await controller.signIn();
  assert.deepEqual(f.calls, ['google.signIn', 'api.signIn', 'store.save:new-account']);
  assert.equal(controller.getState().status, 'signedIn');
});

test('revokes a newly issued server session if secure storage save fails', async () => {
  const f = fixture({
    sessionStore: {
      async load() { return undefined; },
      async save() { throw new AuthStorageError('WRITE_FAILED'); },
      async clear() {},
    },
  });
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), /SECURE_STORAGE_UNAVAILABLE/);
  assert.deepEqual(f.calls, ['google.signIn', 'api.signIn', 'api.logout:new-session']);
  assert.deepEqual(controller.getState(), {
    status: 'signedOut',
    reason: 'SECURE_STORAGE_UNAVAILABLE',
  });
});

test('logout clears local and wallet state even when the server is unreachable', async () => {
  const f = fixture({
    authApi: {
      async signIn() { return newSession; },
      async logout() {
        f.calls.push('api.logout:old-session');
        throw new Error('network unavailable');
      },
    },
  });
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  f.calls.length = 0;
  await controller.logout();
  assert.deepEqual(f.calls, [
    'api.logout:old-session',
    'store.clear',
    'wallet.clear',
    'google.signOut',
  ]);
  assert.deepEqual(controller.getState(), { status: 'signedOut' });
});

test('switch account finishes old cleanup before starting new Google login', async () => {
  const f = fixture();
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  f.calls.length = 0;
  await controller.switchAccount();
  assert.deepEqual(f.calls, [
    'api.logout:old-session',
    'store.clear',
    'wallet.clear',
    'google.signOut',
    'google.signIn',
    'api.signIn',
    'store.save:new-account',
  ]);
  assert.deepEqual(controller.getState(), {
    status: 'signedIn',
    session: newSession,
    credential: { kind: 'bearer', sessionToken: 'new-session' },
  });
});

test('switch cancellation stays signed out instead of restoring the old credential', async () => {
  const f = fixture({
    google: {
      async signIn() {
        f.calls.push('google.signIn');
        throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_CANCELLED');
      },
      async signOut() {
        f.calls.push('google.signOut');
      },
    },
  });
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  f.calls.length = 0;
  await assert.rejects(controller.switchAccount(), /GOOGLE_SIGN_IN_CANCELLED/);
  assert.deepEqual(controller.getState(), {
    status: 'signedOut',
    reason: 'GOOGLE_SIGN_IN_CANCELLED',
  });
  assert.equal(f.stored(), undefined);
});
