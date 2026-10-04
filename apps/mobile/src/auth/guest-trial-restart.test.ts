import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AuthApiError } from './auth-api';
import { createAuthController, type AuthState } from './auth-controller';
import { AuthStorageError, type StoredAuthSessionV1 } from './session-store';
import { reconcileShowcaseAccount, showcaseEntryDestination } from '../navigation/showcase-entry';

const previous: StoredAuthSessionV1 = {
  version: 1, sessionToken: 'old-trial', accountId: 'old-account',
  expiresAt: '2026-10-21T00:00:00.000Z', guest: true,
};
const fresh: StoredAuthSessionV1 = {
  ...previous, sessionToken: 'new-trial', accountId: 'new-account',
};

function fixture(failure?: 'logout' | 'storage' | 'wallet' | 'start' | 'save', session = previous) {
  const calls: string[] = [];
  const states: AuthState[] = [];
  let stored: StoredAuthSessionV1 | undefined = session;
  const controller = createAuthController({
    sessionStore: {
      async load() { return stored; },
      async clear() {
        calls.push('clear');
        if (failure === 'storage') throw new AuthStorageError('DELETE_FAILED');
        stored = undefined;
      },
      async save(value) {
        calls.push('save');
        if (failure === 'save') throw new AuthStorageError('WRITE_FAILED');
        stored = value;
      },
    },
    authApi: {
      async signIn() { throw new Error('Google sign-in must not run'); },
      async logout(token) {
        calls.push(`logout:${token}`);
        if (failure === 'logout') throw new AuthApiError(503, 'SERVICE_UNAVAILABLE');
      },
      async startGuestTrial() {
        calls.push('start');
        if (failure === 'start') throw new AuthApiError(429, 'GUEST_TRIAL_IP_LIMIT');
        return fresh;
      },
    },
    google: {
      async signIn() { throw new Error('Google sign-in must not run'); },
      async signOut() { calls.push('google.signOut'); },
    },
    async clearWalletSession() {
      calls.push('wallet.clear');
      if (failure === 'wallet') throw new Error('wallet unavailable');
    },
    publish(state) { states.push(state); },
  });
  return { controller, calls, states, stored: () => stored };
}

test('restarting a trial revokes and clears the old session before starting and saving the new one', async () => {
  const f = fixture();
  await f.controller.restore();
  f.states.length = 0;
  await f.controller.restartGuestTrial();
  assert.deepEqual(f.calls, ['logout:old-trial', 'clear', 'wallet.clear', 'google.signOut', 'start', 'save']);
  assert.deepEqual(f.states.map(state => state.status), ['signedOut', 'restoring', 'signedIn']);
  assert.deepEqual(f.stored(), fresh);
  assert.deepEqual(f.controller.getState(), {
    status: 'signedIn', session: fresh, credential: { kind: 'bearer', sessionToken: 'new-trial' },
  });
  const entry = reconcileShowcaseAccount({ role: 'customer', accountId: previous.accountId }, fresh.accountId);
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', entry.role, true), 'role');
});

test('cleanup failure stops a trial restart and publishes the existing signed-out reason', async () => {
  for (const [failure, reason] of [
    ['logout', 'SERVER_SESSION_REVOCATION_FAILED'],
    ['storage', 'SECURE_STORAGE_UNAVAILABLE'],
    ['wallet', 'WALLET_STORAGE_CLEANUP_FAILED'],
  ] as const) {
    const f = fixture(failure);
    await f.controller.restore();
    await assert.rejects(f.controller.restartGuestTrial(), { code: reason });
    assert.equal(f.calls.includes('start'), false);
    assert.deepEqual(f.controller.getState(), { status: 'signedOut', reason });
    if (failure !== 'storage') assert.equal(f.stored(), undefined);
  }
});

test('failure to start the replacement trial leaves signed out with its reason and permits a retry', async () => {
  const f = fixture('start');
  await f.controller.restore();
  await assert.rejects(f.controller.restartGuestTrial(), { code: 'GUEST_TRIAL_IP_LIMIT' });
  assert.equal(f.stored(), undefined);
  assert.deepEqual(f.controller.getState(), { status: 'signedOut', reason: 'GUEST_TRIAL_IP_LIMIT' });
  await assert.rejects(f.controller.signInAsGuest(), { code: 'GUEST_TRIAL_IP_LIMIT' });
  assert.equal(f.calls.filter(call => call === 'start').length, 2);
});

test('a replacement trial that cannot be stored is revoked and never published signed in', async () => {
  const f = fixture('save');
  await f.controller.restore();
  f.states.length = 0;
  await assert.rejects(f.controller.restartGuestTrial(), { code: 'SECURE_STORAGE_UNAVAILABLE' });
  assert.equal(f.stored(), undefined);
  assert.equal(f.states.some(state => state.status === 'signedIn'), false);
  assert.deepEqual(f.calls.slice(-3), ['save', 'clear', 'logout:new-trial']);
  assert.deepEqual(f.controller.getState(), { status: 'signedOut', reason: 'SECURE_STORAGE_UNAVAILABLE' });
});

test('trial restart does not revoke a Google session or start from signed out', async () => {
  const f = fixture(undefined, { ...previous, guest: undefined });
  await f.controller.restore();
  await f.controller.restartGuestTrial();
  assert.deepEqual(f.calls, []);
  assert.equal(f.controller.getState().status, 'signedIn');
  await f.controller.logout();
  f.calls.length = 0;
  await f.controller.restartGuestTrial();
  assert.deepEqual(f.calls, []);
});

test('concurrent sign-in waits for the serialized trial restart and cannot replace the fresh session', async () => {
  const f = fixture();
  await f.controller.restore();
  await Promise.all([f.controller.restartGuestTrial(), f.controller.signIn()]);
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
  assert.deepEqual(f.stored(), fresh);
});

test('overlapping restart requests cannot discard the newly issued trial', async () => {
  const f = fixture();
  await f.controller.restore();
  await Promise.all([f.controller.restartGuestTrial(), f.controller.restartGuestTrial()]);
  assert.equal(f.calls.filter(call => call === 'start').length, 1);
  assert.equal(f.calls.filter(call => call === 'logout:new-trial').length, 0);
  assert.deepEqual(f.stored(), fresh);
});
