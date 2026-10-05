import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';

import type { AuthSessionContextValue } from './auth-provider';
import type { StoredAuthSessionV1 } from './session-store';

const authSessionKey = 'masscom.auth.session.v1';
const bindingKey = '@masscom:social-push-binding:v1';
const deviceStateKey = '@masscom:social-push-device-state:v1';

type ModuleLoader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
type StoredBinding = {
  apiUrl: string;
  accountId: string;
  token: string;
  appVariant: 'ANDROID' | 'SHOWCASE_APP';
  status: 'REGISTERING' | 'REGISTERED' | 'UNREGISTER_PENDING';
  deviceId: string;
  bindingRevision: number;
  pendingUnregisterTokens?: string[];
};
type FetchCall = { path: string; method: string; authorization: string | null; body: Record<string, unknown> | undefined };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
const secureStorage = new Map<string, string>();
const asyncStorage = new Map<string, string>();

let hookStates: unknown[] = [];
let hookIndex = 0;
let pendingEffects: (() => void | (() => void))[] = [];
let providerValue: AuthSessionContextValue | undefined;
let providerModule: typeof import('./auth-provider');
let storageModule: typeof import('../social/push-runtime-storage');

const oldSession: StoredAuthSessionV1 = {
  version: 1,
  sessionToken: 'old-trial',
  accountId: 'old-account',
  expiresAt: '2026-10-21T00:00:00.000Z',
  guest: true,
};
const newSession: StoredAuthSessionV1 = {
  version: 1,
  sessionToken: 'new-trial',
  accountId: 'new-account',
  expiresAt: '2026-10-22T00:00:00.000Z',
  guest: true,
};

const secureStore = {
  async getItemAsync(key: string) { return secureStorage.get(key) ?? null; },
  async setItemAsync(key: string, value: string) { secureStorage.set(key, value); },
  async deleteItemAsync(key: string) { secureStorage.delete(key); },
};

const asyncStore = {
  async getItem(key: string) { return asyncStorage.get(key) ?? null; },
  async setItem(key: string, value: string) { asyncStorage.set(key, value); },
  async removeItem(key: string) { asyncStorage.delete(key); },
};

const fakeReact = {
  createContext: (value: unknown) => ({ __masscomContext: true, current: value }),
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => renderElement(type, { ...(props ?? {}), children }),
  use: (context: { current?: unknown }) => context.current,
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = hookIndex++;
    const previous = hookStates[index] as readonly unknown[] | undefined;
    if (depsChanged(previous, deps)) pendingEffects.push(effect);
    hookStates[index] = deps;
  },
  useMemo: (factory: () => unknown, deps?: readonly unknown[]) => {
    const index = hookIndex++;
    const previous = hookStates[index] as { deps?: readonly unknown[]; value: unknown } | undefined;
    if (!previous || depsChanged(previous.deps, deps)) {
      const value = factory();
      hookStates[index] = { deps, value };
      return value;
    }
    return previous.value;
  },
  useRef: (initial: unknown) => {
    const index = hookIndex++;
    if (hookStates[index] === undefined) hookStates[index] = { current: initial };
    return hookStates[index];
  },
  useState: (initial: unknown) => {
    const index = hookIndex++;
    if (hookStates[index] === undefined) hookStates[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    const setState = (next: unknown) => {
      hookStates[index] = typeof next === 'function' ? (next as (current: unknown) => unknown)(hookStates[index]) : next;
    };
    return [hookStates[index], setState];
  },
};

const fakeJsxRuntime = {
  jsx: (type: unknown, props: Record<string, unknown> | null) => renderElement(type, props ?? {}),
  jsxs: (type: unknown, props: Record<string, unknown> | null) => renderElement(type, props ?? {}),
};

function renderElement(type: unknown, props: Record<string, unknown>) {
  if (type && typeof type === 'object' && Reflect.get(type, '__masscomContext') === true) {
    Reflect.set(type, 'current', props.value);
    providerValue = props.value as AuthSessionContextValue;
  }
  return { type, props };
}

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!previous || !next) return true;
  return previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]));
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function resetRenderer() {
  hookStates = [];
  hookIndex = 0;
  pendingEffects = [];
  providerValue = undefined;
}

function renderProvider() {
  hookIndex = 0;
  providerModule.AuthSessionProvider({ children: null });
  return providerValue;
}

function runPendingEffects() {
  const effects = pendingEffects;
  pendingEffects = [];
  for (const effect of effects) effect();
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

async function renderUntilSignedIn(): Promise<AuthSessionContextValue> {
  renderProvider();
  runPendingEffects();
  await flushMicrotasks();
  const value = renderProvider();
  runPendingEffects();
  assert.equal(value?.state.status, 'signedIn');
  assert.equal(value?.session?.sessionToken, oldSession.sessionToken);
  return value;
}

async function waitFor(condition: () => boolean, turns = 80): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  assert.fail('condition was not met before the microtask limit');
}

function seedAuthSession(session: StoredAuthSessionV1) {
  secureStorage.set(authSessionKey, JSON.stringify(session));
}

function readAuthSession(): StoredAuthSessionV1 | undefined {
  const raw = secureStorage.get(authSessionKey);
  return raw ? JSON.parse(raw) as StoredAuthSessionV1 : undefined;
}

function seedPushBinding(binding: StoredBinding) {
  asyncStorage.set(bindingKey, JSON.stringify(binding));
}

function seedDeviceState(bindingRevision: number) {
  asyncStorage.set(deviceStateKey, JSON.stringify({ deviceId: 'device-1', bindingRevision }));
}

function readPushBinding(): StoredBinding | null {
  const raw = asyncStorage.get(bindingKey);
  return raw ? JSON.parse(raw) as StoredBinding : null;
}

function installProviderFetch(options: { pushDeleteFailure?: boolean; holdPushDelete?: boolean } = {}) {
  const calls: FetchCall[] = [];
  const heldPushDeletes: Deferred<Response>[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    const call = { path: parsed.pathname, method: init?.method ?? 'GET', authorization: headers.get('authorization'), body };
    calls.push(call);
    if (call.path === '/me/push-tokens' && call.method === 'DELETE') {
      if (options.holdPushDelete) {
        const held = deferred<Response>();
        heldPushDeletes.push(held);
        return held.promise;
      }
      if (options.pushDeleteFailure) return jsonResponse({ code: 'NETWORK_ERROR' }, 503);
      return jsonResponse({ status: 'REMOVED' });
    }
    if (call.path === '/auth/logout' && call.method === 'POST') return jsonResponse({ status: 'LOGGED_OUT' });
    if (call.path === '/auth/guest-trial' && call.method === 'POST') return jsonResponse(newSession);
    return jsonResponse({ code: 'UNEXPECTED_REQUEST' }, 500);
  });
  return { calls, heldPushDeletes };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

before(async () => {
  process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:8787';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
  moduleWithLoad._load = function patchedLoad(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (request === 'react') return fakeReact;
    if (request === 'react/jsx-runtime') return fakeJsxRuntime;
    if (request === 'react-native') return { Platform: { OS: 'web' } };
    if (request === '@react-native-async-storage/async-storage') return asyncStore;
    if (request === 'expo-application') return { applicationId: 'kr.masscom.wolgye.dev' };
    if (request === 'expo-constants') return { default: { expoConfig: { scheme: 'masscom-dev', extra: {} } } };
    if (request === 'expo-secure-store') return secureStore;
    if (request === 'expo-crypto') return { randomUUID: () => 'notification-device-1' };
    if (request === 'expo-device') return { isDevice: true };
    if (request === '@/notifications/native') return { unregisterCurrentNotificationDevice: async () => undefined };
    if (request === 'react-native-nitro-google-signin') return { GoogleOneTapSignIn: {} };
    if (request === '@/wallet/appkit') return { createAccountScopedAppKit: () => null, walletRuntimeConfig: { available: false } };
    if (request === '@/wallet/appkit-storage') return { listAppKitStorageKeys: async () => [], removeAppKitStorageKeys: async () => undefined };
    if (request === '@/wallet/forget-wallet-session') return { forgetWalletSession: async () => undefined };
    if (request === '@/wallet/account-scope') return { purgeForeignWalletSessions: async () => undefined };
    if (request === '@/screens/collection/collection-prefs') return { purgeForeignCollectionPrefs: async () => undefined };
    if (request === '@/screens/collection/collection-prefs-storage') return { listCollectionPrefKeys: async () => [], removeCollectionPrefKeys: async () => undefined };
    return originalLoad(request, parent, isMain);
  };
  providerModule = await import('./auth-provider') as typeof import('./auth-provider');
  storageModule = await import('../social/push-runtime-storage') as typeof import('../social/push-runtime-storage');
});

beforeEach(() => {
  resetRenderer();
  secureStorage.clear();
  asyncStorage.clear();
  storageModule.resetSocialPushStorageMutationQueueForTest();
});

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  moduleWithLoad._load = originalLoad;
});

test('provider restart serializes deferred push cleanup before one guest replacement', async () => {
  seedAuthSession(oldSession);
  seedPushBinding({ apiUrl: 'http://127.0.0.1:8787', accountId: oldSession.accountId, token: 'ExponentPushToken[old]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  const fetcher = installProviderFetch({ holdPushDelete: true });
  const value = await renderUntilSignedIn();

  const first = value.restartGuestTrial();
  const second = value.restartGuestTrial();
  await waitFor(() => fetcher.heldPushDeletes.length === 1);

  assert.deepEqual(fetcher.calls.map((call) => `${call.method} ${call.path}`), ['DELETE /me/push-tokens']);
  assert.equal(fetcher.calls[0]?.authorization, 'Bearer old-trial');
  assert.deepEqual(fetcher.calls[0]?.body, { token: 'ExponentPushToken[old]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 2 });
  assert.equal(readPushBinding()?.status, 'UNREGISTER_PENDING');
  assert.equal(readPushBinding()?.accountId, oldSession.accountId);

  fetcher.heldPushDeletes[0]!.resolve(jsonResponse({ status: 'REMOVED' }));
  await Promise.all([first, second]);
  await flushMicrotasks();
  renderProvider();

  assert.deepEqual(fetcher.calls.map((call) => `${call.method} ${call.path}`), [
    'DELETE /me/push-tokens',
    'POST /auth/logout',
    'POST /auth/guest-trial',
  ]);
  assert.equal(fetcher.calls[1]?.authorization, 'Bearer old-trial');
  assert.equal(fetcher.calls.filter((call) => call.authorization === 'Bearer new-trial').length, 0);
  assert.equal(readPushBinding(), null);
  assert.deepEqual(readAuthSession(), newSession);
});

test('provider restart keeps durable old push cleanup intent when server delete returns 503', async () => {
  seedAuthSession(oldSession);
  seedPushBinding({ apiUrl: 'http://127.0.0.1:8787', accountId: oldSession.accountId, token: 'ExponentPushToken[old]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  const fetcher = installProviderFetch({ pushDeleteFailure: true });
  const value = await renderUntilSignedIn();

  await value.restartGuestTrial();
  await flushMicrotasks();
  renderProvider();

  assert.deepEqual(fetcher.calls.map((call) => `${call.method} ${call.path}`), [
    'DELETE /me/push-tokens',
    'POST /auth/logout',
    'POST /auth/guest-trial',
  ]);
  assert.equal(fetcher.calls[0]?.authorization, 'Bearer old-trial');
  assert.deepEqual(fetcher.calls[0]?.body, { token: 'ExponentPushToken[old]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 2 });
  assert.deepEqual(readPushBinding(), {
    apiUrl: 'http://127.0.0.1:8787',
    accountId: oldSession.accountId,
    token: 'ExponentPushToken[old]',
    appVariant: 'ANDROID',
    status: 'UNREGISTER_PENDING',
    deviceId: 'device-1',
    bindingRevision: 2,
    pendingUnregisterTokens: [],
  });
  assert.deepEqual(readAuthSession(), newSession);
});
