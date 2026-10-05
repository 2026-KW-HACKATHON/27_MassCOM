import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canOpenMailForBinding,
  canRegisterPushBinding,
  parseStoredPushBinding,
  pushBindingForRegistration,
  pushBindingPendingUnregister,
  pushBindingRegistered,
} from './push-runtime-rules';

const current = {
  apiUrl: 'https://api.example.test',
  accountId: 'account-a',
  token: 'ExponentPushToken[token-a]',
  appVariant: 'ANDROID' as const,
  deviceId: 'device-1',
  bindingRevision: 1,
};

test('push binding registration blocks active owners but permits pending-owner transfer', () => {
  const active = pushBindingRegistered(pushBindingForRegistration({ ...current, accountId: 'account-old' }));
  const stale = pushBindingPendingUnregister(active);
  assert.equal(canRegisterPushBinding(active, current), false);
  assert.equal(canRegisterPushBinding(stale, current), true);
  assert.equal(canRegisterPushBinding(stale, { ...current, appVariant: 'SHOWCASE_APP' }), true);
  assert.equal(canRegisterPushBinding(stale, { ...current, apiUrl: 'https://other.example.test' }), true);
});

test('push binding unregister failure is durable without storing credentials', () => {
  const registering = pushBindingForRegistration(current);
  const registered = pushBindingRegistered(registering);
  const pending = pushBindingPendingUnregister(registered);

  assert.deepEqual(parseStoredPushBinding(pending), pending);
  assert.equal(Object.hasOwn(pending, 'credential'), false);
  assert.equal(Object.hasOwn(pending, 'authorization'), false);
});

test('mail push opens only for the currently registered account binding', () => {
  const registered = pushBindingRegistered(pushBindingForRegistration(current));
  assert.equal(canOpenMailForBinding(registered, current), true);
  assert.equal(canOpenMailForBinding(registered, { ...current, accountId: 'account-b' }), false);
  assert.equal(canOpenMailForBinding(pushBindingPendingUnregister(registered), current), false);
  assert.equal(canOpenMailForBinding(null, current), false);
});