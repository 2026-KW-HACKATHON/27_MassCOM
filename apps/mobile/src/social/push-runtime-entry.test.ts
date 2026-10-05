import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';

const bindingKey = '@masscom:social-push-binding:v1';
const cleanupKey = '@masscom:social-push-cleanups:v1';
const deviceStateKey = '@masscom:social-push-device-state:v1';
type ModuleLoader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
const storage = new Map<string, string>();
const effects: (() => void | (() => void))[] = [];
let pushTokenListener: ((token: unknown) => void) | undefined;
let getExpoPushToken = async (_options: { projectId?: string; devicePushToken?: unknown }) => ({ data: 'ExponentPushToken[current]' });
const notifications = {
  getPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  requestPermissionsAsync: async () => ({ granted: true, status: 'granted' }),
  getExpoPushTokenAsync: async (options: { projectId?: string; devicePushToken?: unknown }) => getExpoPushToken(options),
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponseAsync: async () => undefined,
  addPushTokenListener: (listener: (token: unknown) => void) => { pushTokenListener = listener; return { remove() {} }; },
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  setNotificationHandler: () => undefined,
};
const asyncStorage = {
  async getItem(key: string) { return storage.get(key) ?? null; },
  async setItem(key: string, value: string) { storage.set(key, value); },
  async removeItem(key: string) { storage.delete(key); },
};
const fakeReact = {
  createContext: (value: unknown) => ({ value }),
  createElement: (...args: unknown[]) => ({ args }),
  use: (value: unknown) => value,
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [initial, () => undefined],
};
let runtimeModule: typeof import('./push-runtime');
let storageModule: typeof import('./push-runtime-storage');
let restartImportIndex = 0;

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

type FetchCall = { url: string; method: string; body: { token?: string; appVariant?: string; deviceId?: string; bindingRevision?: number } | undefined };

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function installFetch(result: 'success' | 'fail' | Deferred<Response> = 'success') {
  const calls: FetchCall[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) as FetchCall['body'] : undefined });
    if (typeof result === 'object' && calls.length === 1) return result.promise;
    if (result === 'fail') return new Response(JSON.stringify({ code: 'NETWORK_ERROR' }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ status: init?.method === 'DELETE' ? 'REMOVED' : 'REGISTERED' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}



function installSelectivePushFetch(options: { failPostTokens?: Set<string>; holdDelete?: (body: NonNullable<FetchCall['body']>) => boolean } = {}) {
  const calls: FetchCall[] = [];
  const heldDeletes: Deferred<Response>[] = [];
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as NonNullable<FetchCall['body']> : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (init?.method === 'POST' && body?.token && options.failPostTokens?.has(body.token)) {
      return new Response(JSON.stringify({ code: 'NETWORK_ERROR' }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    if (init?.method === 'DELETE' && body && options.holdDelete?.(body)) {
      const held = deferred<Response>();
      heldDeletes.push(held);
      return held.promise;
    }
    return new Response(JSON.stringify({ status: init?.method === 'DELETE' ? 'REMOVED' : 'REGISTERED' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { calls, heldDeletes };
}

function installDeferredPushFetch() {
  const calls: FetchCall[] = [];
  const postResponses = new Map<string, Deferred<Response>>();
  mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { token?: string } : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (init?.method === 'POST' && body?.token) {
      const response = deferred<Response>();
      postResponses.set(body.token, response);
      return response.promise;
    }
    return new Response(JSON.stringify({ status: init?.method === 'DELETE' ? 'REMOVED' : 'REGISTERED' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return {
    calls,
    resolvePost(token: string) {
      const response = postResponses.get(token);
      assert.ok(response, `missing deferred POST for ${token}`);
      response.resolve(new Response(JSON.stringify({ status: 'REGISTERED' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
}

function seedBinding(binding: StoredBinding) {
  storage.set(bindingKey, JSON.stringify(binding));
}

function seedDeviceState(bindingRevision: number) {
  storage.set(deviceStateKey, JSON.stringify({ deviceId: 'device-1', bindingRevision }));
}

function readBinding(): StoredBinding | null {
  const raw = storage.get(bindingKey);
  return raw ? JSON.parse(raw) as StoredBinding : null;
}

function seedCleanups(cleanups: StoredBinding[]) {
  storage.set(cleanupKey, JSON.stringify(cleanups));
}

function readCleanups(): StoredBinding[] {
  const raw = storage.get(cleanupKey);
  return raw ? JSON.parse(raw) as StoredBinding[] : [];
}

async function reloadRuntimeModulesForTest(): Promise<void> {
  restartImportIndex += 1;
  effects.length = 0;
  pushTokenListener = undefined;
  runtimeModule = await import(`./push-runtime?restart=${restartImportIndex}`) as typeof import('./push-runtime');
  storageModule.resetSocialPushStorageMutationQueueForTest();
}

async function flushMicrotasks(turns = 5): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

async function waitFor(condition: () => boolean, turns = 50): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
}

before(async () => {
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
  moduleWithLoad._load = function patchedLoad(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (request === 'react') return fakeReact;
    if (request === 'react-native') return { Platform: { OS: 'ios' } };
    if (request === '@react-native-async-storage/async-storage') return asyncStorage;
    if (request === 'expo-application') return { applicationId: 'kr.masscom.wolgye' };
    if (request === 'expo-constants') return { default: { expoConfig: { scheme: 'masscom' } } };
    if (request === 'expo-notifications') return notifications;
    return originalLoad(request, parent, isMain);
  };
  (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: typeof notifications }).__masscomSocialPushNotifications = notifications;
  runtimeModule = await import('./push-runtime');
  storageModule = await import('./push-runtime-storage');
});

beforeEach(() => {
  storage.clear();
  effects.length = 0;
  pushTokenListener = undefined;
  getExpoPushToken = async () => ({ data: 'ExponentPushToken[current]' });
  storageModule.resetSocialPushStorageMutationQueueForTest();
});

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  moduleWithLoad._load = originalLoad;
  delete (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: typeof notifications }).__masscomSocialPushNotifications;
});

test('runtime revoke persists pending revision before HTTP and removes it on ACK', async () => {
  seedBinding({ apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[current]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  const calls = installFetch();

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'secret-token' } });

  assert.equal(readBinding(), null);
  assert.deepEqual(calls.map((call) => call.body), [{ token: 'ExponentPushToken[current]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 2 }]);
  assert.equal(JSON.stringify(storage), '{}');
});

test('runtime revoke network failure leaves pending revision for retry', async () => {
  seedBinding({ apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[current]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  const calls = installFetch('fail');

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'secret-token' } });

  assert.equal(readBinding()?.status, 'UNREGISTER_PENDING');
  assert.equal(readBinding()?.bindingRevision, 2);
  assert.deepEqual(calls.map((call) => call.body), [{ token: 'ExponentPushToken[current]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 2 }]);
});

test('runtime revoke without credential persists pending revision and starts zero HTTP', async () => {
  seedBinding({ apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[current]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  const calls = installFetch();

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID' });

  const binding = readBinding();
  assert.equal(binding?.status, 'UNREGISTER_PENDING');
  assert.equal(binding?.bindingRevision, 2);
  assert.equal(Object.hasOwn(binding ?? {}, 'credential'), false);
  assert.equal(Object.hasOwn(binding ?? {}, 'authorization'), false);
  assert.deepEqual(calls, []);
});

test('runtime stale A cleanup cannot overwrite B persisted binding', async () => {
  const staleA = { apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[current]', appVariant: 'ANDROID' as const, status: 'UNREGISTER_PENDING' as const, deviceId: 'device-1', bindingRevision: 2 };
  const bindingB = { ...staleA, accountId: 'account-b', status: 'REGISTERING' as const, bindingRevision: 3 };
  seedBinding(bindingB);

  await storageModule.queuedPushBindingStore.storeIfCurrent(staleA, { ...staleA, pendingUnregisterTokens: [] });

  assert.deepEqual(readBinding(), bindingB);
});


test('runtime same-generation newer token ACK wins over older delayed ACK and logout revokes newest binding', async () => {
  seedDeviceState(0);
  const nativeB = { type: 'native-b' };
  getExpoPushToken = async (options) => ({ data: options.devicePushToken === nativeB ? 'ExponentPushToken[B]' : 'ExponentPushToken[A]' });
  const fetcher = installDeferredPushFetch();

  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-a',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'secret-token' },
    projectId: 'project-1',
  });
  for (const effect of effects) effect();

  await waitFor(() => fetcher.calls.filter((call) => call.method === 'POST').length === 1 && readBinding()?.token === 'ExponentPushToken[A]' && readBinding()?.status === 'REGISTERING');
  assert.ok(pushTokenListener);
  pushTokenListener(nativeB);
  await waitFor(() => fetcher.calls.filter((call) => call.method === 'POST').length === 2 && readBinding()?.token === 'ExponentPushToken[B]' && readBinding()?.bindingRevision === 2);

  fetcher.resolvePost('ExponentPushToken[B]');
  await waitFor(() => readBinding()?.token === 'ExponentPushToken[B]' && readBinding()?.status === 'REGISTERED');
  fetcher.resolvePost('ExponentPushToken[A]');
  await flushMicrotasks(50);

  assert.equal(readBinding()?.token, 'ExponentPushToken[B]');
  assert.equal(readBinding()?.status, 'REGISTERED');
  assert.equal(readBinding()?.bindingRevision, 2);

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'secret-token' } });

  const deletes = fetcher.calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(deletes.map((call) => call.body), [
    { token: 'ExponentPushToken[A]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 2 },
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 3 },
  ]);
  assert.equal(readBinding(), null);
});


test('runtime failed same-account rotation logout cleans new and preserved old authority', async () => {
  seedBinding({ apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[old]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 1 });
  seedDeviceState(1);
  getExpoPushToken = async () => ({ data: 'ExponentPushToken[new]' });
  const fetcher = installSelectivePushFetch({ failPostTokens: new Set(['ExponentPushToken[new]']) });

  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-a',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'secret-token' },
    projectId: 'project-1',
  });
  for (const effect of effects) effect();
  await waitFor(() => fetcher.calls.some((call) => call.method === 'POST'));

  assert.equal(readBinding()?.token, 'ExponentPushToken[new]');
  assert.equal(readBinding()?.status, 'REGISTERING');
  assert.deepEqual(readCleanups().map((cleanup) => cleanup.token), ['ExponentPushToken[old]']);

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'secret-token' } });

  const deletes = fetcher.calls.filter((call) => call.method === 'DELETE').map((call) => call.body);
  assert.deepEqual(deletes, [
    { token: 'ExponentPushToken[new]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 3 },
    { token: 'ExponentPushToken[old]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 4 },
  ]);
  assert.equal(readBinding(), null);
  assert.deepEqual(readCleanups(), []);
});

test('runtime cross-account failed replacement logout does not use B credential for A cleanup and later A cleanup retires it', async () => {
  const aPending = { apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[A]', appVariant: 'ANDROID' as const, status: 'UNREGISTER_PENDING' as const, deviceId: 'device-1', bindingRevision: 2, pendingUnregisterTokens: ['ExponentPushToken[A-old]'] };
  seedBinding(aPending);
  seedDeviceState(2);
  getExpoPushToken = async () => ({ data: 'ExponentPushToken[B]' });
  const fetcher = installSelectivePushFetch({ failPostTokens: new Set(['ExponentPushToken[B]']) });

  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-b',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'b-secret' },
    projectId: 'project-1',
  });
  for (const effect of effects) effect();
  await waitFor(() => fetcher.calls.some((call) => call.method === 'POST'));
  assert.deepEqual(readCleanups().map((cleanup) => cleanup.accountId), ['account-a']);

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-b', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'b-secret' } });

  assert.deepEqual(fetcher.calls.filter((call) => call.method === 'DELETE').map((call) => call.body), [
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 4 },
  ]);
  assert.equal(readBinding(), null);
  assert.deepEqual(readCleanups().map((cleanup) => cleanup.accountId), ['account-a']);

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'a-secret' } });

  assert.deepEqual(fetcher.calls.filter((call) => call.method === 'DELETE').map((call) => call.body), [
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 4 },
    { token: 'ExponentPushToken[A]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 5 },
    { token: 'ExponentPushToken[A-old]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 5 },
  ]);
  assert.deepEqual(readCleanups(), []);
});

test('runtime cleanup ACK at stale revision is retained after newer logout and fresh retry retires it', async () => {
  seedCleanups([{ apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[A]', appVariant: 'ANDROID', status: 'UNREGISTER_PENDING', deviceId: 'device-1', bindingRevision: 3 }]);
  seedDeviceState(3);
  const fetcher = installSelectivePushFetch({ holdDelete: (body) => body.token === 'ExponentPushToken[A]' && body.bindingRevision === 4 });

  const staleCleanup = runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'a-secret' } });
  await waitFor(() => fetcher.heldDeletes.length === 1 && readCleanups()[0]?.bindingRevision === 4);

  seedBinding({ apiUrl: 'https://api.example.test', accountId: 'account-b', token: 'ExponentPushToken[B]', appVariant: 'ANDROID', status: 'REGISTERED', deviceId: 'device-1', bindingRevision: 4 });
  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-b', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'b-secret' } });
  assert.equal(readBinding(), null);

  fetcher.heldDeletes[0]!.resolve(new Response(JSON.stringify({ status: 'REMOVED' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await staleCleanup;
  assert.equal(readCleanups()[0]?.token, 'ExponentPushToken[A]');
  assert.equal(readCleanups()[0]?.bindingRevision, 4);

  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-a', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'a-secret' } });

  assert.deepEqual(fetcher.calls.filter((call) => call.method === 'DELETE').map((call) => call.body), [
    { token: 'ExponentPushToken[A]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 4 },
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 5 },
    { token: 'ExponentPushToken[A]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 6 },
  ]);
  assert.deepEqual(readCleanups(), []);
});


test('runtime restart after cross-account failed replacement keeps A cleanup through B logout', async () => {
  const aPending = { apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[A]', appVariant: 'ANDROID' as const, status: 'UNREGISTER_PENDING' as const, deviceId: 'device-1', bindingRevision: 2, pendingUnregisterTokens: ['ExponentPushToken[A-old]'] };
  seedBinding(aPending);
  seedDeviceState(2);
  getExpoPushToken = async () => ({ data: 'ExponentPushToken[B]' });
  const fetcher = installSelectivePushFetch({ failPostTokens: new Set(['ExponentPushToken[B]']) });

  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-b',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'b-secret' },
    projectId: 'project-1',
  });
  for (const effect of effects) effect();
  await waitFor(() => fetcher.calls.some((call) => call.method === 'POST'));
  assert.deepEqual(readCleanups().map((cleanup) => cleanup.accountId), ['account-a']);

  await reloadRuntimeModulesForTest();
  await runtimeModule.revokeSocialPushBindings({ apiUrl: 'https://api.example.test', accountId: 'account-b', appVariant: 'ANDROID', credential: { kind: 'bearer', sessionToken: 'b-secret' } });

  assert.deepEqual(fetcher.calls.filter((call) => call.method === 'DELETE').map((call) => call.body), [
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 4 },
  ]);
  assert.equal(readBinding(), null);
  assert.deepEqual(readCleanups(), [aPending]);
});

test('runtime confirmed higher-revision exact-device B transfer retires A cleanup intent', async () => {
  const aPending = { apiUrl: 'https://api.example.test', accountId: 'account-a', token: 'ExponentPushToken[A]', appVariant: 'ANDROID' as const, status: 'UNREGISTER_PENDING' as const, deviceId: 'device-1', bindingRevision: 2, pendingUnregisterTokens: ['ExponentPushToken[A-old]'] };
  seedBinding(aPending);
  seedDeviceState(2);
  getExpoPushToken = async () => ({ data: 'ExponentPushToken[B]' });
  const fetcher = installSelectivePushFetch();

  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-b',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'b-secret' },
    projectId: 'project-1',
  });
  for (const effect of effects) effect();

  await waitFor(() => readBinding()?.accountId === 'account-b' && readBinding()?.status === 'REGISTERED' && fetcher.calls.some((call) => call.method === 'POST'));

  assert.deepEqual(fetcher.calls.filter((call) => call.method === 'POST').map((call) => call.body), [
    { token: 'ExponentPushToken[B]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 3 },
  ]);
  await waitFor(() => readCleanups().length === 0);
  assert.equal(readBinding()?.token, 'ExponentPushToken[B]');
  assert.deepEqual(readCleanups(), []);
});

test('runtime hook compensates an in-flight registration after revocation generation changes', async () => {
  seedDeviceState(0);
  const heldRegister = deferred<Response>();
  const calls = installFetch(heldRegister);

  assert.equal(effects.length, 0);
  runtimeModule.useSocialPushBinding({
    apiUrl: 'https://api.example.test',
    accountId: 'account-a',
    appVariant: 'ANDROID',
    credential: { kind: 'bearer', sessionToken: 'secret-token' },
    projectId: 'project-1',
  });
  assert.equal(effects.length, 2);
  for (const effect of effects) effect();
  await flushMicrotasks(50);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.method, 'POST');
  assert.equal(readBinding()?.status, 'REGISTERING');
  assert.equal(readBinding()?.bindingRevision, 1);

  runtimeModule.beginSocialPushBindingRevocation();
  heldRegister.resolve(new Response(JSON.stringify({ status: 'REGISTERED' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  await waitFor(() => calls.length === 2 && readBinding() === null);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'DELETE']);
  assert.deepEqual(calls[1]?.body, { token: 'ExponentPushToken[current]', appVariant: 'ANDROID', deviceId: 'device-1', bindingRevision: 1 });
  assert.equal(readBinding(), null);
});