import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';

const bindingKey = '@masscom:social-push-binding:v1';
type ModuleLoader = (request: string, parent: NodeModule | null | undefined, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
const storage = new Map<string, string>();
const effects: (() => void | (() => void))[] = [];
const mailId = '11111111-1111-4111-8111-111111111111';
let authState = {
  accountId: 'account-a',
  credential: { kind: 'bearer' as const, sessionToken: 'session-token' },
};
let lastResponse: NotificationResponse | null = null;
let clearCount = 0;
let responseSubscriptions: { listener: (response: NotificationResponse) => void; removed: boolean }[] = [];
let pushSubscriptions: { listener: (token: { data?: string }) => void; removed: boolean }[] = [];
let openMailCalls: string[] = [];
let fetchCalls: { url: string; method: string; body?: unknown }[] = [];
let importIndex = 0;
let heldNotificationList: Deferred<Response> | undefined;
let heldBindingRead: Deferred<string | null> | undefined;

type NotificationResponse = { notification: { request: { identifier?: string; content: { data?: Record<string, unknown> } } } };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const asyncStorage = {
  async getItem(key: string) {
    if (key === bindingKey && heldBindingRead) return heldBindingRead.promise;
    return storage.get(key) ?? null;
  },
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

const notifications = {
  getPermissionsAsync: async () => ({ granted: false, status: 'denied', canAskAgain: true }),
  requestPermissionsAsync: async () => ({ granted: false, status: 'denied', canAskAgain: true }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[current]' }),
  getLastNotificationResponse: () => lastResponse,
  clearLastNotificationResponse: () => { clearCount += 1; lastResponse = null; },
  getLastNotificationResponseAsync: async () => lastResponse,
  clearLastNotificationResponseAsync: async () => { clearCount += 1; lastResponse = null; },
  addPushTokenListener: (listener: (token: { data?: string }) => void) => {
    const entry = { listener, removed: false };
    pushSubscriptions.push(entry);
    return { remove() { entry.removed = true; } };
  },
  addNotificationResponseReceivedListener: (listener: (response: NotificationResponse) => void) => {
    const entry = { listener, removed: false };
    responseSubscriptions.push(entry);
    return { remove() { entry.removed = true; } };
  },
  setNotificationHandler: () => undefined,
};

function response(data: Record<string, unknown>, identifier = `id-${Math.random()}`): NotificationResponse {
  return { notification: { request: { identifier, content: { data } } } };
}

function notificationListResponse(): Response {
  return Response.json({ items: [{ id: 'notice-1', category: 'REWARD_AVAILABLE', title: '새 보상', body: '도감을 확인해요', targetPath: '/collection', createdAt: '2026-10-05T00:00:00.000Z', readAt: null }] });
}

function seedRegisteredSocialBinding() {
  storage.set(bindingKey, JSON.stringify({
    apiUrl: 'https://api.example.test',
    accountId: authState.accountId,
    token: 'ExponentPushToken[current]',
    appVariant: 'ANDROID',
    status: 'REGISTERED',
    deviceId: 'device-1',
    bindingRevision: 1,
  }));
}

function installFetch() {
  mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    fetchCalls.push({ url, method, body });
    if (url.endsWith('/api/notifications/preferences')) {
      return Response.json({ preferences: { pushEnabled: true, rewardAvailable: true, couponExpiring: true, campaignExpiring: true } });
    }
    if (url.endsWith('/api/notifications/devices')) return new Response(null, { status: 204 });
    if (url.endsWith('/api/notifications')) {
      if (heldNotificationList) return heldNotificationList.promise;
      return notificationListResponse();
    }
    if (url.endsWith('/api/notifications/notice-1/read')) return new Response(null, { status: 204 });
    if (url.endsWith('/me/push-tokens')) return Response.json({ status: method === 'DELETE' ? 'REMOVED' : 'REGISTERED' });
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
}

async function importFreshModules() {
  importIndex += 1;
  const social = await import(`../social/push-runtime?twoBridge=${importIndex}`) as typeof import('../social/push-runtime');
  const bridge = await import(`./session-bridge?twoBridge=${importIndex}`) as typeof import('./session-bridge');
  const pending = await import('./pending-target') as typeof import('./pending-target');
  return { social, bridge, pending };
}

function mountSocial(modules: Awaited<ReturnType<typeof importFreshModules>>) {
  modules.social.SocialPushProvider({
    apiUrl: 'https://api.example.test',
    accountId: authState.accountId,
    credential: authState.credential,
    appVariant: 'ANDROID',
    projectId: 'project-1',
    onOpenMail: (id: string) => { openMailCalls.push(id); },
    children: null,
  });
}

function mountNotification(modules: Awaited<ReturnType<typeof importFreshModules>>) {
  modules.bridge.NotificationSessionBridge();
}

function mountBridgeOrder(order: 'social-first' | 'notification-first', modules: Awaited<ReturnType<typeof importFreshModules>>) {
  if (order === 'social-first') {
    mountSocial(modules);
    mountNotification(modules);
  } else {
    mountNotification(modules);
    mountSocial(modules);
  }
}

async function runEffects(): Promise<(() => void)[]> {
  const cleanups: (() => void)[] = [];
  const queued = effects.splice(0, effects.length);
  for (const effect of queued) {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    await flushMicrotasks(20);
  }
  await flushMicrotasks(50);
  return cleanups;
}

async function flushMicrotasks(turns = 10): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

async function mount(order: 'social-first' | 'notification-first', cold: NotificationResponse | null = null) {
  const modules = await importFreshModules();
  seedRegisteredSocialBinding();
  installFetch();
  lastResponse = cold;
  mountBridgeOrder(order, modules);
  const cleanups = await runEffects();
  return { ...modules, cleanups };
}

function live(responseValue: NotificationResponse) {
  for (const subscription of responseSubscriptions) {
    if (!subscription.removed) subscription.listener(responseValue);
  }
}

before(() => {
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
  moduleWithLoad._load = function patchedLoad(request: string, parent: NodeModule | null | undefined, isMain: boolean) {
    if (request === 'react') return fakeReact;
    if (request === 'react-native') return { Platform: { OS: 'android' }, Linking: { openURL: async () => undefined } };
    if (request === '@react-native-async-storage/async-storage') return asyncStorage;
    if (request === 'expo-application') return { applicationId: 'kr.masscom.wolgye' };
    if (request === 'expo-constants') return { default: { expoConfig: { scheme: 'masscom' }, easConfig: { projectId: 'project-1' } } };
    if (request === 'expo-notifications') return notifications;
    if (request === 'expo-secure-store') return { getItemAsync: async () => null, setItemAsync: async () => undefined };
    if (request === 'expo-crypto') return { randomUUID: () => 'notification-device-1' };
    if (request === '@/auth/auth-provider') return { useAuthSession: () => authState };
    if (request === '@/config/public-api-runtime') return { publicApiConfig: { available: true, apiUrl: 'https://api.example.test' } };
    if (request === './native') return {
      getNativeFcmToken: async () => 'native-fcm-token',
      getNotificationDeviceId: async () => 'notification-device-1',
    };
    return originalLoad(request, parent, isMain);
  };
  (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: typeof notifications }).__masscomSocialPushNotifications = notifications;
});

beforeEach(() => {
  storage.clear();
  effects.length = 0;
  clearCount = 0;
  responseSubscriptions = [];
  pushSubscriptions = [];
  openMailCalls = [];
  fetchCalls = [];
  lastResponse = null;
  heldNotificationList = undefined;
  heldBindingRead = undefined;
  authState = { accountId: 'account-a', credential: { kind: 'bearer', sessionToken: 'session-token' } };
});

afterEach(() => {
  mock.restoreAll();
});

after(() => {
  moduleWithLoad._load = originalLoad;
  delete (globalThis as typeof globalThis & { __masscomSocialPushNotifications?: typeof notifications }).__masscomSocialPushNotifications;
});

for (const order of ['social-first', 'notification-first'] as const) {
  test(`cold social mail response is opened and cleared only by social bridge (${order})`, async () => {
    const { pending } = await mount(order, response({ mailId }, 'social-cold'));

    assert.deepEqual(openMailCalls, [mailId]);
    assert.equal(clearCount, 1);
    assert.equal(pending.consumeNotificationTarget(authState.accountId), undefined);
    assert.equal(fetchCalls.some((call) => call.url.includes('/api/notifications/notice-1/read')), false);
  });

  test(`cold upstream notification response is queued and cleared only by notification bridge (${order})`, async () => {
    const { pending } = await mount(order, response({ notificationId: 'notice-1' }, 'notice-cold'));

    assert.deepEqual(openMailCalls, []);
    assert.equal(clearCount, 1);
    assert.equal(pending.consumeNotificationTarget(authState.accountId), '/collection');
    assert.equal(fetchCalls.some((call) => call.url.endsWith('/api/notifications/notice-1/read')), true);
  });
}

test('cold unknown response mounted under both bridges is not cleared or routed', async () => {
  const { pending } = await mount('social-first', response({ notificationId: 'missing-notice', mailId: 'not-a-uuid' }, 'unknown-cold'));

  assert.deepEqual(openMailCalls, []);
  assert.equal(clearCount, 0);
  assert.equal(pending.consumeNotificationTarget(authState.accountId), undefined);
  assert.equal(fetchCalls.some((call) => call.url.includes('/read')), false);
});


test('deferred upstream cold clear preserves a newer social cold response for later social mount', async () => {
  const modules = await importFreshModules();
  seedRegisteredSocialBinding();
  installFetch();
  heldNotificationList = deferred<Response>();
  const socialResponse = response({ mailId }, 'social-after-upstream-await');
  lastResponse = response({ notificationId: 'notice-1' }, 'upstream-awaiting');

  mountNotification(modules);
  await runEffects();
  await flushMicrotasks(10);
  assert.equal(fetchCalls.filter((call) => call.url.endsWith('/api/notifications')).length, 1);

  lastResponse = socialResponse;
  live(socialResponse);
  await flushMicrotasks(10);
  assert.deepEqual(openMailCalls, []);

  heldNotificationList.resolve(notificationListResponse());
  await flushMicrotasks(40);

  assert.equal(lastResponse, socialResponse, 'newer social response must remain in the native slot after upstream finishes old response');
  mountSocial(modules);
  await runEffects();
  assert.deepEqual(openMailCalls, [mailId]);
  assert.equal(clearCount, 1);
});

test('deferred social cold clear preserves a newer upstream cold response for later notification mount', async () => {
  const modules = await importFreshModules();
  seedRegisteredSocialBinding();
  installFetch();
  const rawBinding = storage.get(bindingKey)!;
  heldBindingRead = deferred<string | null>();
  const upstreamResponse = response({ notificationId: 'notice-1' }, 'upstream-after-social-await');
  lastResponse = response({ mailId }, 'social-awaiting');

  mountSocial(modules);
  await runEffects();
  await flushMicrotasks(10);

  lastResponse = upstreamResponse;
  live(upstreamResponse);
  await flushMicrotasks(10);
  assert.equal(fetchCalls.some((call) => call.url.endsWith('/api/notifications/notice-1/read')), false);

  heldBindingRead.resolve(rawBinding);
  await flushMicrotasks(40);

  assert.deepEqual(openMailCalls, [mailId]);
  assert.equal(lastResponse, upstreamResponse, 'newer upstream response must remain in the native slot after social finishes old response');
  mountNotification(modules);
  await runEffects();
  assert.equal(modules.pending.consumeNotificationTarget(authState.accountId), '/collection');
  assert.equal(clearCount, 1);
});



test('in-flight social cold binding read does not open or clear after provider unmount', async () => {
  const modules = await importFreshModules();
  seedRegisteredSocialBinding();
  installFetch();
  const rawBinding = storage.get(bindingKey)!;
  heldBindingRead = deferred<string | null>();
  const socialResponse = response({ mailId }, 'social-unmount-awaiting');
  lastResponse = socialResponse;

  mountSocial(modules);
  const cleanups = await runEffects();
  await flushMicrotasks(10);

  for (const cleanup of cleanups.reverse()) cleanup();
  heldBindingRead.resolve(rawBinding);
  await flushMicrotasks(40);

  assert.deepEqual(openMailCalls, []);
  assert.equal(lastResponse, socialResponse);
  assert.equal(clearCount, 0);
});

test('live responses route once to each owning bridge and unmount removes both listeners', async () => {
  const { pending, cleanups } = await mount('notification-first');
  assert.equal(responseSubscriptions.filter((entry) => !entry.removed).length, 2);

  live(response({ mailId }, 'mail-live'));
  live(response({ notificationId: 'notice-1' }, 'notice-live'));
  await flushMicrotasks(30);

  assert.deepEqual(openMailCalls, [mailId]);
  assert.equal(pending.consumeNotificationTarget(authState.accountId), '/collection');
  assert.equal(clearCount, 0);
  assert.equal(fetchCalls.filter((call) => call.url.endsWith('/api/notifications/notice-1/read')).length, 1);

  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(responseSubscriptions.every((entry) => entry.removed), true);
  assert.equal(pushSubscriptions.every((entry) => entry.removed), true);
});
