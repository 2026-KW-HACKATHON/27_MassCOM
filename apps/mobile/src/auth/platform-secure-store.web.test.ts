import assert from 'node:assert/strict';
import { test } from 'node:test';

import { platformSecureStore } from './platform-secure-store.web';

// node:test runs without a DOM; a tiny Map-backed stand-in is enough to exercise the three
// methods this file wraps around window.localStorage.
function fakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

test('round-trips a value through getItemAsync/setItemAsync/deleteItemAsync', async () => {
  (globalThis as { window?: unknown }).window = { localStorage: fakeLocalStorage() };
  try {
    assert.equal(await platformSecureStore.getItemAsync('missing'), null);
    await platformSecureStore.setItemAsync('masscom.auth.session.v1', 'stored-value');
    assert.equal(await platformSecureStore.getItemAsync('masscom.auth.session.v1'), 'stored-value');
    await platformSecureStore.deleteItemAsync('masscom.auth.session.v1');
    assert.equal(await platformSecureStore.getItemAsync('masscom.auth.session.v1'), null);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
