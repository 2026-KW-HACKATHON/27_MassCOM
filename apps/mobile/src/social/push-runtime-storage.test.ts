import AsyncStorage from '@react-native-async-storage/async-storage';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { unregisterStoredPushBinding, type PushBindingClient } from './push-runtime-coordinator';
import { pushBindingForRegistration, pushBindingPendingUnregister, pushBindingRegistered, pushBindingMatchesInput, type PushBindingCandidate, type StoredSocialPushBinding } from './push-runtime-rules';
import { preparePushBindingRegistration, preparePushBindingRevocation, queuedPushBindingStore, readBinding, resetSocialPushStorageMutationQueueForTest } from './push-runtime-storage';

const bindingKey = '@masscom:social-push-binding:v1';
const cleanupKey = '@masscom:social-push-cleanups:v1';
const deviceStateKey = '@masscom:social-push-device-state:v1';

const base: PushBindingCandidate = {
  apiUrl: 'https://api.example.test',
  accountId: 'account-a',
  token: 'ExponentPushToken[current]',
  appVariant: 'ANDROID',
  deviceId: 'device-1',
  bindingRevision: 1,
};

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function installAsyncStorageMock() {
  const values = new Map<string, string>();
  const deferredSetItems = new Map<string, Deferred<void>[]>();
  const failSetItemKeys = new Set<string>();
  mock.method(AsyncStorage, 'getItem', async (key: string) => values.get(key) ?? null);
  mock.method(AsyncStorage, 'setItem', async (key: string, value: string) => {
    const waiters = deferredSetItems.get(key);
    if (waiters?.length) await waiters.shift()!.promise;
    if (failSetItemKeys.has(key)) throw new Error(`WRITE_FAILED:${key}`);
    values.set(key, value);
  });
  mock.method(AsyncStorage, 'removeItem', async (key: string) => { values.delete(key); });
  return {
    values,
    failSetItemKeys,
    deferNextSetItem(key: string) {
      const gate = deferred<void>();
      const waiters = deferredSetItems.get(key) ?? [];
      waiters.push(gate);
      deferredSetItems.set(key, waiters);
      return gate;
    },
    binding() {
      const raw = values.get(bindingKey);
      return raw ? JSON.parse(raw) as StoredSocialPushBinding : null;
    },
    cleanupRaw() { return values.get(cleanupKey) ?? null; },
    cleanups() {
      const raw = values.get(cleanupKey);
      return raw ? JSON.parse(raw) as StoredSocialPushBinding[] : [];
    },
    seedBinding(binding: StoredSocialPushBinding) { values.set(bindingKey, JSON.stringify(binding)); },
    seedCleanups(cleanups: StoredSocialPushBinding[]) { values.set(cleanupKey, JSON.stringify(cleanups)); },
    seedDeviceState(bindingRevision: number) { values.set(deviceStateKey, JSON.stringify({ deviceId: 'device-1', bindingRevision })); },
  };
}

function client(failUnregister = false) {
  const registered: unknown[] = [];
  const unregistered: unknown[] = [];
  const api: PushBindingClient = {
    async registerPushToken(input) { registered.push(input); },
    async unregisterPushToken(input) {
      unregistered.push(input);
      if (failUnregister) throw new Error('UNREGISTER_FAILED');
    },
  };
  return { api, registered, unregistered };
}

beforeEach(() => {
  resetSocialPushStorageMutationQueueForTest();
});

afterEach(() => {
  mock.restoreAll();
  resetSocialPushStorageMutationQueueForTest();
});

test('revocation persists pending with a new revision before HTTP; ACK removes that exact record', async () => {
  const storage = installAsyncStorageMock();
  const registered = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(registered);
  storage.seedDeviceState(1);

  const revoking = await preparePushBindingRevocation({ apiUrl: base.apiUrl, accountId: base.accountId, appVariant: base.appVariant, matches: pushBindingMatchesInput });
  assert.equal(revoking?.status, 'UNREGISTER_PENDING');
  assert.equal(revoking?.bindingRevision, 2);
  assert.equal(storage.binding()?.status, 'UNREGISTER_PENDING');
  assert.equal(storage.binding()?.bindingRevision, 2);

  const api = client();
  await unregisterStoredPushBinding({ binding: revoking!, client: api.api, store: queuedPushBindingStore });

  assert.equal(storage.binding(), null);
  assert.deepEqual(api.unregistered, [{ token: base.token, appVariant: base.appVariant, deviceId: base.deviceId, bindingRevision: 2 }]);
});

test('revocation failure retains the already-persisted pending binding for retry', async () => {
  const storage = installAsyncStorageMock();
  storage.seedBinding(pushBindingRegistered(pushBindingForRegistration(base)));
  storage.seedDeviceState(1);

  const revoking = await preparePushBindingRevocation({ apiUrl: base.apiUrl, accountId: base.accountId, appVariant: base.appVariant, matches: pushBindingMatchesInput });
  const api = client(true);
  await unregisterStoredPushBinding({ binding: revoking!, client: api.api, store: queuedPushBindingStore });

  assert.equal(storage.binding()?.status, 'UNREGISTER_PENDING');
  assert.equal(storage.binding()?.bindingRevision, 2);
  assert.deepEqual(api.unregistered, [{ token: base.token, appVariant: base.appVariant, deviceId: base.deviceId, bindingRevision: 2 }]);
});

test('pending old account can transfer to B and stale A cleanup cannot overwrite B with deferred storage interleaving', async () => {
  const storage = installAsyncStorageMock();
  const oldPending = pushBindingPendingUnregister(pushBindingRegistered(pushBindingForRegistration({ ...base, bindingRevision: 2 })));
  storage.seedBinding(oldPending);
  storage.seedDeviceState(2);
  const bWrite = storage.deferNextSetItem(bindingKey);

  const bPrepare = preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: 'account-b', token: base.token, appVariant: base.appVariant });
  const staleCleanup = queuedPushBindingStore.storeIfCurrent(oldPending, pushBindingPendingUnregister(oldPending));
  await Promise.resolve();
  bWrite.resolve();
  const preparedB = await bPrepare;
  await staleCleanup;

  assert.equal(preparedB?.registering.accountId, 'account-b');
  assert.equal(preparedB?.registering.bindingRevision, 3);
  assert.equal(storage.binding()?.accountId, 'account-b');
  assert.equal(storage.binding()?.bindingRevision, 3);
});


test('conditional binding store requires exact status and pending token intent', async () => {
  const storage = installAsyncStorageMock();
  const registering = pushBindingForRegistration(base);
  storage.seedBinding(pushBindingPendingUnregister(registering));

  const staleRegistered = await queuedPushBindingStore.storeIfCurrent(registering, pushBindingRegistered(registering));
  assert.equal(staleRegistered, false);
  assert.equal(storage.binding()?.status, 'UNREGISTER_PENDING');

  storage.seedBinding(pushBindingRegistered(registering, ['ExponentPushToken[old]']));
  const missingPending = await queuedPushBindingStore.storeIfCurrent(pushBindingRegistered(registering), pushBindingRegistered(registering, []));
  assert.equal(missingPending, false);
  assert.deepEqual(storage.binding()?.pendingUnregisterTokens, ['ExponentPushToken[old]']);

  const exact = pushBindingRegistered(registering, ['ExponentPushToken[old]']);
  const replaced = await queuedPushBindingStore.storeIfCurrent(exact, pushBindingRegistered(registering, []));
  assert.equal(replaced, true);
  assert.deepEqual(storage.binding()?.pendingUnregisterTokens, []);
});



test('current binding removal requires the latest persisted device revision', async () => {
  const storage = installAsyncStorageMock();
  const revoking = pushBindingPendingUnregister(pushBindingForRegistration({ ...base, bindingRevision: 2 }));
  storage.seedBinding(revoking);
  storage.seedDeviceState(3);

  await queuedPushBindingStore.removeIfCurrent(revoking);
  assert.deepEqual(storage.binding(), revoking);

  storage.seedDeviceState(2);
  await queuedPushBindingStore.removeIfCurrent(revoking);
  assert.equal(storage.binding(), null);
});

test('current binding removal keeps authority when device revision cannot be read strictly', async () => {
  const storage = installAsyncStorageMock();
  const revoking = pushBindingPendingUnregister(pushBindingForRegistration({ ...base, bindingRevision: 2 }));
  storage.seedBinding(revoking);
  storage.values.set(deviceStateKey, JSON.stringify({ deviceId: 1, bindingRevision: 2 }));

  await queuedPushBindingStore.removeIfCurrent(revoking);
  assert.deepEqual(storage.binding(), revoking);
});

test('registration preserves prior cleanup authority before replacing current binding', async () => {
  const storage = installAsyncStorageMock();
  const old = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(old);
  storage.seedDeviceState(1);

  const prepared = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[new]', appVariant: base.appVariant });

  assert.equal(prepared?.registering.token, 'ExponentPushToken[new]');
  assert.deepEqual(storage.cleanups(), [pushBindingPendingUnregister(old)]);
  assert.equal(storage.binding()?.token, 'ExponentPushToken[new]');
});

test('multiple failed replacements retain every unresolved cleanup authority', async () => {
  const storage = installAsyncStorageMock();
  const old = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(old);
  storage.seedDeviceState(1);

  const first = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[first]', appVariant: base.appVariant });
  const second = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[second]', appVariant: base.appVariant });

  assert.equal(first?.registering.bindingRevision, 2);
  assert.equal(second?.registering.bindingRevision, 3);
  assert.deepEqual(storage.cleanups().map((cleanup) => cleanup.token), [base.token, 'ExponentPushToken[first]']);
  assert.equal(storage.binding()?.token, 'ExponentPushToken[second]');
});

test('old cleanup intent write failure prevents registration HTTP and preserves current binding', async () => {
  const storage = installAsyncStorageMock();
  const old = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(old);
  storage.seedDeviceState(1);
  storage.failSetItemKeys.add(cleanupKey);
  const api = client();

  await assert.rejects(async () => {
    const prepared = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[new]', appVariant: base.appVariant });
    if (prepared) await api.api.registerPushToken({ token: prepared.registering.token, appVariant: prepared.registering.appVariant, deviceId: prepared.registering.deviceId, bindingRevision: prepared.registering.bindingRevision });
  }, /WRITE_FAILED/);

  assert.deepEqual(api.registered, []);
  assert.deepEqual(storage.binding(), old);
  assert.equal(storage.cleanupRaw(), null);
});

test('new registration intent write failure prevents HTTP while retaining prior cleanup evidence', async () => {
  const storage = installAsyncStorageMock();
  const old = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(old);
  storage.seedDeviceState(1);
  storage.failSetItemKeys.add(bindingKey);
  const api = client();

  await assert.rejects(async () => {
    const prepared = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[new]', appVariant: base.appVariant });
    if (prepared) await api.api.registerPushToken({ token: prepared.registering.token, appVariant: prepared.registering.appVariant, deviceId: prepared.registering.deviceId, bindingRevision: prepared.registering.bindingRevision });
  }, /WRITE_FAILED/);

  assert.deepEqual(api.registered, []);
  assert.deepEqual(storage.binding(), old);
  assert.deepEqual(storage.cleanups(), [pushBindingPendingUnregister(old)]);
});

test('corrupt durable push state fails closed before replacement HTTP', async () => {
  const cases: { key: string; value: string; pattern: RegExp }[] = [
    { key: bindingKey, value: JSON.stringify({ apiUrl: 1 }), pattern: /INVALID_PUSH_BINDING/ },
    { key: deviceStateKey, value: JSON.stringify({ deviceId: 1, bindingRevision: 1 }), pattern: /INVALID_PUSH_DEVICE_STATE/ },
    { key: cleanupKey, value: JSON.stringify([{ apiUrl: 1 }]), pattern: /INVALID_PUSH_CLEANUPS/ },
  ];

  for (const failure of cases) {
    const storage = installAsyncStorageMock();
    storage.seedBinding(pushBindingRegistered(pushBindingForRegistration(base)));
    storage.seedDeviceState(1);
    storage.values.set(failure.key, failure.value);
    const api = client();

    await assert.rejects(async () => {
      const prepared = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[new]', appVariant: base.appVariant });
      if (prepared) await api.api.registerPushToken({ token: prepared.registering.token, appVariant: prepared.registering.appVariant, deviceId: prepared.registering.deviceId, bindingRevision: prepared.registering.bindingRevision });
    }, failure.pattern);

    assert.deepEqual(api.registered, []);
    assert.equal(storage.values.get(failure.key), failure.value);
    mock.restoreAll();
    resetSocialPushStorageMutationQueueForTest();
  }
});

test('revision write failure prevents registration HTTP and leaves binding unchanged', async () => {
  const storage = installAsyncStorageMock();
  storage.failSetItemKeys.add(deviceStateKey);
  const api = client();

  await assert.rejects(async () => {
    const prepared = await preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: base.token, appVariant: base.appVariant });
    if (prepared) await api.api.registerPushToken({ token: prepared.registering.token, appVariant: prepared.registering.appVariant, deviceId: prepared.registering.deviceId, bindingRevision: prepared.registering.bindingRevision });
  }, /WRITE_FAILED/);

  assert.deepEqual(api.registered, []);
  assert.equal(storage.binding(), null);
});

test('pending binding write failure prevents unregister HTTP and preserves the registered binding', async () => {
  const storage = installAsyncStorageMock();
  const registered = pushBindingRegistered(pushBindingForRegistration(base));
  storage.seedBinding(registered);
  storage.seedDeviceState(1);
  storage.failSetItemKeys.add(bindingKey);
  const api = client();

  await assert.rejects(async () => {
    const revoking = await preparePushBindingRevocation({ apiUrl: base.apiUrl, accountId: base.accountId, appVariant: base.appVariant, matches: pushBindingMatchesInput });
    if (revoking) await unregisterStoredPushBinding({ binding: revoking, client: api.api, store: queuedPushBindingStore });
  }, /WRITE_FAILED/);

  assert.deepEqual(api.unregistered, []);
  assert.deepEqual(storage.binding(), registered);
});

test('concurrent registrations serialize revision allocation into distinct increasing revisions', async () => {
  const storage = installAsyncStorageMock();
  storage.seedDeviceState(0);

  const [first, second] = await Promise.all([
    preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[first]', appVariant: base.appVariant }),
    preparePushBindingRegistration({ apiUrl: base.apiUrl, accountId: base.accountId, token: 'ExponentPushToken[second]', appVariant: base.appVariant }),
  ]);

  assert.equal(first?.registering.bindingRevision, 1);
  assert.equal(second?.registering.bindingRevision, 2);
  assert.equal((await readBinding())?.bindingRevision, 2);
});
