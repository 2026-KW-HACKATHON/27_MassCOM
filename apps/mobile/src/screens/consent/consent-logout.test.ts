import assert from 'node:assert/strict';
import test from 'node:test';

import { finishConsentLogout } from './consent-logout';
import { AuthApiError } from '@/auth/auth-api';
import { createAuthController, type AuthState } from '@/auth/auth-controller';
import type { StoredAuthSessionV1 } from '@/auth/session-store';

test('consent logout consumes a server revocation rejection', async () => {
  let calls = 0;
  await assert.doesNotReject(finishConsentLogout(async () => {
    calls += 1;
    throw new Error('SERVER_SESSION_REVOCATION_FAILED');
  }));
  assert.equal(calls, 1);
});

test('consent logout also consumes a synchronous callback failure', async () => {
  await assert.doesNotReject(finishConsentLogout(() => {
    throw new Error('SERVER_SESSION_REVOCATION_FAILED');
  }));
});

test('consent logout clears a guest session even when server revocation fails', async () => {
  for (const [status, code] of [
    [401, 'SESSION_INVALID'], [404, 'NOT_FOUND'], [500, 'SERVER_ERROR'],
    [503, 'ACCOUNT_AUTH_NOT_CONFIGURED'], [0, 'NETWORK_ERROR'],
  ] as const) {
    let stored: StoredAuthSessionV1 | undefined = {
      version: 1, sessionToken: 'trial-token', accountId: 'trial-account',
      expiresAt: '2026-10-21T00:00:00.000Z', guest: true,
    };
    const states: AuthState[] = [];
    const controller = createAuthController({
      sessionStore: {
        async load() { return stored; },
        async save(session) { stored = session; },
        async clear() { stored = undefined; },
      },
      authApi: {
        async signIn() { throw new Error('unexpected sign-in'); },
        async startGuestTrial() { throw new Error('unexpected guest trial'); },
        async logout() { throw new AuthApiError(status, code); },
      },
      google: {
        async signIn() { throw new Error('unexpected Google sign-in'); },
        async signOut() {},
      },
      async clearWalletSession() {},
      publish(state) { states.push(state); },
    });
    await controller.restore();
    assert.equal(controller.getState().status, 'signedIn', `${status} before logout`);
    await assert.doesNotReject(finishConsentLogout(controller.logout));
    assert.equal(stored, undefined, `${status} cleared local storage`);
    assert.deepEqual(controller.getState(), {
      status: 'signedOut', reason: 'SERVER_SESSION_REVOCATION_FAILED',
    }, `${status} keeps the established warning reason`);
    assert.deepEqual(states.at(-1), controller.getState());
  }
});
