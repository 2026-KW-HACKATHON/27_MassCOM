import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPushBindingWithServer, unregisterStoredPushBinding, type PushBindingClient, type PushBindingStore } from './push-runtime-coordinator';
import { pushBindingForRegistration, pushBindingPendingUnregister, pushBindingRegistered, type PushBindingCandidate, type StoredSocialPushBinding } from './push-runtime-rules';

function memoryStore(initial: StoredSocialPushBinding | null = null) {
  let binding = initial;
  const writes: (StoredSocialPushBinding | null)[] = [];
  const store: PushBindingStore = {
    async read() { return binding; },
    async store(next) { binding = next; writes.push(next); },
    async storeIfCurrent(current, next) {
      if (!sameBinding(binding, current)) {
        writes.push(binding);
        return false;
      }
      binding = next;
      writes.push(binding);
      return true;
    },
    async removeIfCurrent(current) {
      if (sameBinding(binding, current)) binding = null;
      writes.push(binding);
    },
  };
  return { store, get binding() { return binding; }, set binding(next: StoredSocialPushBinding | null) { binding = next; }, writes };
}

function sameBinding(current: StoredSocialPushBinding | null, expected: StoredSocialPushBinding): boolean {
  const currentPending = current?.pendingUnregisterTokens ?? [];
  const expectedPending = expected.pendingUnregisterTokens ?? [];
  return Boolean(current && current.apiUrl === expected.apiUrl && current.accountId === expected.accountId
    && current.token === expected.token && current.appVariant === expected.appVariant
    && current.deviceId === expected.deviceId && current.bindingRevision === expected.bindingRevision
    && current.status === expected.status && currentPending.length === expectedPending.length
    && currentPending.every((token, index) => token === expectedPending[index]));
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function client(failUnregister = new Set<string>()) {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const api: PushBindingClient = {
    async registerPushToken(input) { registered.push(`${input.appVariant}:${input.token}:${input.deviceId}:${input.bindingRevision}`); },
    async unregisterPushToken(input) {
      unregistered.push(`${input.appVariant}:${input.token}:${input.deviceId}:${input.bindingRevision}`);
      if (failUnregister.has(input.token)) throw new Error('UNREGISTER_FAILED');
    },
  };
  return { api, registered, unregistered };
}

const candidate: PushBindingCandidate = {
  apiUrl: 'https://api.example.test',
  accountId: 'account-a',
  token: 'ExponentPushToken[current]',
  appVariant: 'ANDROID',
  deviceId: 'device-1',
  bindingRevision: 1,
};

test('pending unregister failure is kept for retry without credentials until server ack removes it', async () => {
  const existing = pushBindingPendingUnregister(pushBindingRegistered(pushBindingForRegistration(candidate)));
  const firstStore = memoryStore(existing);
  const firstClient = client(new Set([candidate.token]));
  await unregisterStoredPushBinding({ binding: existing, client: firstClient.api, store: firstStore.store });
  assert.equal(firstStore.binding?.status, 'UNREGISTER_PENDING');
  assert.equal(Object.hasOwn(firstStore.binding ?? {}, 'credential'), false);

  const retryStore = memoryStore(firstStore.binding);
  const retryClient = client();
  await unregisterStoredPushBinding({ binding: retryStore.binding!, client: retryClient.api, store: retryStore.store });
  assert.deepEqual(retryClient.unregistered, ['ANDROID:ExponentPushToken[current]:device-1:1']);
  assert.equal(retryStore.binding, null);
});

test('a new account can take over a pending old account token after the server transfer ack', async () => {
  const stale = pushBindingPendingUnregister(pushBindingRegistered(pushBindingForRegistration({ ...candidate, accountId: 'account-a' })));
  const next = { ...candidate, accountId: 'account-b', bindingRevision: 2 };
  const state = memoryStore(stale);
  const api = client();

  await registerPushBindingWithServer({ candidate: next, client: api.api, store: state.store, stillCurrent: () => true });

  assert.deepEqual(api.registered, ['ANDROID:ExponentPushToken[current]:device-1:2']);
  assert.equal(api.unregistered.length, 0);
  assert.equal(state.binding?.accountId, 'account-b');
  assert.equal(state.binding?.status, 'REGISTERED');
  assert.deepEqual(state.binding?.pendingUnregisterTokens, []);
});



test('stale old-account unregister failure cannot overwrite a newer account binding', async () => {
  const stale = pushBindingPendingUnregister(pushBindingRegistered(pushBindingForRegistration({ ...candidate, accountId: 'account-a' })));
  const current = pushBindingRegistered(pushBindingForRegistration({ ...candidate, accountId: 'account-b', bindingRevision: 2 }));
  const state = memoryStore(current);
  const api = client(new Set([candidate.token]));

  await unregisterStoredPushBinding({ binding: stale, client: api.api, store: state.store });

  assert.equal(state.binding?.accountId, 'account-b');
  assert.equal(state.binding?.bindingRevision, 2);
});

test('same-account token rotation registers the new token and retires the prior token', async () => {
  const previous = pushBindingRegistered(pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[old]' }), ['ExponentPushToken[older]']);
  const next = { ...candidate, token: 'ExponentPushToken[new]', bindingRevision: 2 };
  const state = memoryStore(previous);
  const api = client();

  await registerPushBindingWithServer({ candidate: next, client: api.api, store: state.store, stillCurrent: () => true });

  assert.deepEqual(api.registered, ['ANDROID:ExponentPushToken[new]:device-1:2']);
  assert.deepEqual(api.unregistered, ['ANDROID:ExponentPushToken[old]:device-1:2', 'ANDROID:ExponentPushToken[older]:device-1:2']);
  assert.equal(state.binding?.token, 'ExponentPushToken[new]');
  assert.deepEqual(state.binding?.pendingUnregisterTokens, []);
});


test('same-generation older registration ACK cannot overwrite a newer persisted registration', async () => {
  const olderRegistering = pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[A]', bindingRevision: 1 });
  const newerRegistering = pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[B]', bindingRevision: 2 });
  const newerRegistered = pushBindingRegistered(newerRegistering);
  const state = memoryStore(olderRegistering);
  const heldOlder = deferred<void>();
  const api: PushBindingClient = {
    async registerPushToken(input) {
      if (input.token === olderRegistering.token) await heldOlder.promise;
    },
    async unregisterPushToken() {},
  };

  const older = registerPushBindingWithServer({ candidate: olderRegistering, client: api, store: state.store, stillCurrent: () => true, previous: null, registering: olderRegistering });
  await Promise.resolve();
  state.binding = newerRegistering;
  await registerPushBindingWithServer({ candidate: newerRegistering, client: api, store: state.store, stillCurrent: () => true, previous: olderRegistering, registering: newerRegistering });
  assert.deepEqual(state.binding, newerRegistered);

  heldOlder.resolve();
  await older;

  assert.deepEqual(state.binding, newerRegistered);
});

test('same-account pending cleanup cannot rewrite a newer persisted binding', async () => {
  const previous = pushBindingRegistered(pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[old]' }), ['ExponentPushToken[older]']);
  const nextRegistering = pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[new]', bindingRevision: 2 });
  const newerBinding = pushBindingRegistered(pushBindingForRegistration({ ...candidate, token: 'ExponentPushToken[newer]', bindingRevision: 3 }));
  const state = memoryStore(nextRegistering);
  const api: PushBindingClient = {
    async registerPushToken() {},
    async unregisterPushToken() { state.binding = newerBinding; },
  };

  await registerPushBindingWithServer({ candidate: nextRegistering, client: api, store: state.store, stillCurrent: () => true, previous, registering: nextRegistering });

  assert.deepEqual(state.binding, newerBinding);
});

test('late registration after logout unregisters the just-registered token and never marks it registered', async () => {
  const state = memoryStore();
  const api = client();

  await registerPushBindingWithServer({ candidate, client: api.api, store: state.store, stillCurrent: () => false });

  assert.deepEqual(api.registered, ['ANDROID:ExponentPushToken[current]:device-1:1']);
  assert.deepEqual(api.unregistered, ['ANDROID:ExponentPushToken[current]:device-1:1']);
  assert.equal(state.binding, null);
});