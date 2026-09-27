import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthApiError } from './auth-api';
import { AuthControllerError, createAuthController, type AuthControllerDependencies, type AuthState } from './auth-controller';
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

test('uninvited showcase account stays signed out with a distinct reason', async () => {
  const f = fixture({
    authApi: {
      async signIn() { throw new AuthApiError(403, 'INVITE_REQUIRED'); },
      async logout() { throw new Error('unexpected logout'); },
    },
  });
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);

  await assert.rejects(controller.signIn(), (error) =>
    error instanceof AuthControllerError && error.code === 'ACCOUNT_NOT_INVITED');
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'ACCOUNT_NOT_INVITED' });
  assert.equal(f.stored(), undefined);
});

test('network failure is not confused with a Google account picker failure', async () => {
  const f = fixture({
    authApi: {
      async signIn() { throw new AuthApiError(0, 'NETWORK_ERROR'); },
      async logout() { throw new Error('unexpected logout'); },
    },
  });
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), (error) =>
    error instanceof AuthControllerError && error.code === 'NETWORK_ERROR');
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'NETWORK_ERROR' });
});

test('a stalled login reports response delay rather than a disconnected network', async () => {
  const f = fixture({
    authApi: {
      async signIn() { throw new AuthApiError(0, 'REQUEST_TIMEOUT'); },
      async logout() { throw new Error('unexpected logout'); },
    },
  });
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), (error) =>
    error instanceof AuthControllerError && error.code === 'REQUEST_TIMEOUT');
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'REQUEST_TIMEOUT' });
});

test('native Google picker failure stays distinct from a network failure', async () => {
  const f = fixture({
    google: {
      async signIn() { throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_FAILED'); },
      async signOut() {},
    },
  });
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), (error) =>
    error instanceof AuthControllerError && error.code === 'GOOGLE_SIGN_IN_FAILED');
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'GOOGLE_SIGN_IN_FAILED' });
});

test('server login rate limit asks for a later retry', async () => {
  const f = fixture({
    authApi: {
      async signIn() { throw new AuthApiError(429, 'LOGIN_RATE_LIMITED'); },
      async logout() { throw new Error('unexpected logout'); },
    },
  });
  f.setStored(undefined);
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), (error) =>
    error instanceof AuthControllerError && error.code === 'LOGIN_RATE_LIMITED');
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'LOGIN_RATE_LIMITED' });
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

test('clears a partially written session even when server revocation also fails', async () => {
  let persisted: StoredAuthSessionV1 | undefined;
  const f = fixture({
    sessionStore: {
      async load() { return persisted; },
      async save(session) {
        persisted = session;
        throw new AuthStorageError('WRITE_FAILED');
      },
      async clear() {
        f.calls.push('store.clear');
        persisted = undefined;
      },
    },
    authApi: {
      async signIn() {
        f.calls.push('api.signIn');
        return newSession;
      },
      async logout() {
        f.calls.push('api.logout:new-session');
        throw new Error('network unavailable');
      },
    },
  });
  const controller = createAuthController(f.dependencies);
  await assert.rejects(controller.signIn(), /SECURE_STORAGE_UNAVAILABLE/);
  assert.equal(persisted, undefined);
  assert.deepEqual(f.calls, [
    'google.signIn',
    'api.signIn',
    'store.clear',
    'api.logout:new-session',
  ]);
});

test('serializes overlapping sign-ins so memory and storage cannot select different accounts', async () => {
  let googleCalls = 0;
  let stored: StoredAuthSessionV1 | undefined;
  let releaseFirstSave!: () => void;
  let firstSaveStarted!: () => void;
  const firstSave = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
  const started = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
  const f = fixture({
    google: {
      async signIn() {
        googleCalls += 1;
        return { idToken: `google-${googleCalls}` };
      },
      async signOut() {},
    },
    authApi: {
      async signIn(idToken) {
        return idToken === 'google-1'
          ? { ...oldSession, sessionToken: 'session-1', accountId: 'account-1' }
          : { ...newSession, sessionToken: 'session-2', accountId: 'account-2' };
      },
      async logout() {},
    },
    sessionStore: {
      async load() { return stored; },
      async save(session) {
        stored = session;
        if (session.sessionToken === 'session-1') {
          firstSaveStarted();
          await firstSave;
        }
      },
      async clear() { stored = undefined; },
    },
  });
  const controller = createAuthController(f.dependencies);
  const first = controller.signIn();
  await started;
  const second = controller.signIn();
  releaseFirstSave();
  await Promise.all([first, second]);
  assert.equal(googleCalls, 1);
  const finalState = controller.getState();
  assert.equal(finalState.status, 'signedIn');
  if (finalState.status !== 'signedIn') return;
  assert.equal(finalState.session.sessionToken, stored?.sessionToken);
});

test('logout clears local state but reports unrevoked server session when offline', async () => {
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
  await assert.rejects(controller.logout(), /SERVER_SESSION_REVOCATION_FAILED/);
  assert.deepEqual(f.calls, [
    'api.logout:old-session',
    'store.clear',
    'wallet.clear',
    'google.signOut',
  ]);
  assert.deepEqual(controller.getState(), { status: 'signedOut', reason: 'SERVER_SESSION_REVOCATION_FAILED' });
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

test('ignores a stale invalidation after account switch and serializes an extra login tap', async () => {
  const f = fixture();
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  await Promise.all([controller.switchAccount(), controller.signIn()]);
  await controller.invalidateSession('old-session');
  const finalState = controller.getState();
  assert.equal(finalState.status, 'signedIn');
  if (finalState.status !== 'signedIn') return;
  assert.equal(finalState.session.sessionToken, 'new-session');
  assert.equal(f.calls.filter((call) => call === 'google.signIn').length, 1);
});

test('stops logout and switch success when local wallet storage cannot be purged', async () => {
  const f = fixture({
    async clearWalletSession() {
      f.calls.push('wallet.clear');
      throw new Error('local storage unavailable');
    },
  });
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  await assert.rejects(controller.logout(), /WALLET_STORAGE_CLEANUP_FAILED/);
  assert.deepEqual(controller.getState(), {
    status: 'signedOut',
    reason: 'WALLET_STORAGE_CLEANUP_FAILED',
  });
});

test('rejects an account switch that returns the same server account', async () => {
  const f = fixture({
    authApi: {
      async signIn() { return { ...oldSession, sessionToken: 'replacement-session' }; },
      async logout(token) { f.calls.push(`api.logout:${token}`); },
    },
  });
  const controller = createAuthController(f.dependencies);
  await controller.restore();
  await assert.rejects(controller.switchAccount(), /ACCOUNT_SWITCH_UNCHANGED/);
  assert.deepEqual(controller.getState(), {
    status: 'signedOut',
    reason: 'ACCOUNT_SWITCH_UNCHANGED',
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
