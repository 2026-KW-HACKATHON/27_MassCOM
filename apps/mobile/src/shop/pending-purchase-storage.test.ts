import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enterShopPurchaseScope, isShopPurchaseScopeActive, leaveShopPurchaseScope, resetShopPurchaseCoordinatorForTest, subscribeShopPurchaseScope } from './purchase-coordinator';
import { PendingPurchaseStorageError, clearPendingPurchase, pendingPurchaseScope, pendingPurchaseScopeKey, pendingPurchaseStorageKey, readPendingPurchase, writePendingPurchase } from './pending-purchase-storage';

test('pending purchase keys are stable for the account across bearer relogin but split by API origin and app variant', () => {
  const first = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/v1', appVariant: 'kr.masscom.app' });
  const relogin = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/other-path', appVariant: 'kr.masscom.app' });
  const otherAccount = pendingPurchaseScope({ accountId: 'acct-2', apiUrl: 'https://api.example.test/v1', appVariant: 'kr.masscom.app' });
  const showcase = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/v1', appVariant: 'kr.masscom.demo' });
  assert.equal(pendingPurchaseScopeKey(first), pendingPurchaseScopeKey(relogin));
  assert.equal(pendingPurchaseStorageKey(first), pendingPurchaseStorageKey(relogin));
  assert.notEqual(pendingPurchaseStorageKey(first), pendingPurchaseStorageKey(otherAccount));
  assert.notEqual(pendingPurchaseStorageKey(first), pendingPurchaseStorageKey(showcase));
});

test('purchase coordinator lets only one shop entry own a scope at a time', () => {
  resetShopPurchaseCoordinatorForTest();
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test', appVariant: 'kr.masscom.app' });
  const first = enterShopPurchaseScope(scope);
  assert.ok(first);
  assert.equal(isShopPurchaseScopeActive(scope), true);
  assert.equal(enterShopPurchaseScope(scope), undefined, 'second tab must not overwrite or POST another pending request');
  leaveShopPurchaseScope(first);
  const second = enterShopPurchaseScope(scope);
  assert.ok(second);
  leaveShopPurchaseScope(second);
});

test('late old owner completion cannot release a newer owner and release wakes blocked entries', () => {
  resetShopPurchaseCoordinatorForTest();
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test', appVariant: 'kr.masscom.app' });
  const events: string[] = [];
  const unsubscribe = subscribeShopPurchaseScope(scope, () => { events.push('released'); });
  const oldLease = enterShopPurchaseScope(scope);
  assert.ok(oldLease);
  leaveShopPurchaseScope(oldLease);
  assert.deepEqual(events, ['released']);
  const newLease = enterShopPurchaseScope(scope);
  assert.ok(newLease);
  leaveShopPurchaseScope(oldLease);
  assert.equal(isShopPurchaseScopeActive(scope), true, 'late cleanup from old owner must not unlock the new owner');
  assert.equal(enterShopPurchaseScope(scope), undefined);
  leaveShopPurchaseScope(newLease);
  assert.deepEqual(events, ['released', 'released']);
  unsubscribe();
});

test('response-loss pending survives GET refresh and second shop entry cannot overwrite the original request', async () => {
  resetShopPurchaseCoordinatorForTest();
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/shop', appVariant: 'kr.masscom.app' });
  const original = { grade: 'SILVER' as const, requestId: 'draw-original', expectedRemaining: 7 };
  const nextAttempt = { grade: 'GOLD' as const, requestId: 'draw-new', expectedRemaining: 3 };
  const testGlobal = globalThis as unknown as { window?: unknown };
  const previousWindow = testGlobal.window;
  const storage = new Map<string, string>();
  testGlobal.window = {
    localStorage: {
      get length() { return storage.size; },
      clear: () => { storage.clear(); },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => { storage.delete(key); },
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  };
  let lease = enterShopPurchaseScope(scope);
  try {
    await clearPendingPurchase(scope);
    assert.ok(lease);
    await writePendingPurchase(scope, original);

    // A second mounted entry for the same account/API/app must block instead of replacing the unresolved POST.
    assert.equal(enterShopPurchaseScope(scope), undefined);
    assert.deepEqual(await readPendingPurchase(scope), original);

    // GET /shop refresh is allowed to read current state but must not clear unresolved POST recovery data.
    assert.deepEqual(await readPendingPurchase(scope), original);

    leaveShopPurchaseScope(lease);
    lease = enterShopPurchaseScope(scope);
    assert.ok(lease);
    const stored = await readPendingPurchase(scope);
    if (!stored) await writePendingPurchase(scope, nextAttempt);
    assert.deepEqual(await readPendingPurchase(scope), original, 'new purchase flow must replay the original requestId after response loss');
    leaveShopPurchaseScope(lease);
    lease = undefined;
    await clearPendingPurchase(scope);
  } finally {
    if (lease) leaveShopPurchaseScope(lease);
    testGlobal.window = previousWindow;
  }
});
test('storage read failure preserves existing pending and blocks a fresh overwrite until retry recovers the same request', async () => {
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/shop', appVariant: 'kr.masscom.app' });
  const original = { grade: 'SILVER' as const, requestId: 'draw-original', expectedRemaining: 7 };
  const nextAttempt = { grade: 'GOLD' as const, requestId: 'draw-new', expectedRemaining: 3 };
  const storageKey = pendingPurchaseStorageKey(scope);
  const testGlobal = globalThis as unknown as { window?: unknown };
  const previousWindow = testGlobal.window;
  const storage = new Map<string, string>([[storageKey, JSON.stringify(original)]]);
  let getFailures = 1;
  let setCalls = 0;
  let removeCalls = 0;
  testGlobal.window = {
    localStorage: {
      get length() { return storage.size; },
      clear: () => { storage.clear(); },
      getItem: (key: string) => {
        if (getFailures > 0) { getFailures -= 1; throw new Error('read failed once'); }
        return storage.get(key) ?? null;
      },
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => { removeCalls += 1; storage.delete(key); },
      setItem: (key: string, value: string) => { setCalls += 1; storage.set(key, value); },
    },
  };
  try {
    let blocked = false;
    try {
      const stored = await readPendingPurchase(scope);
      if (!stored) await writePendingPurchase(scope, nextAttempt);
    } catch (error) {
      blocked = error instanceof PendingPurchaseStorageError;
    }
    assert.equal(blocked, true);
    assert.equal(setCalls, 0, 'unknown pending state must not be overwritten by a fresh request');
    assert.equal(removeCalls, 0, 'unknown pending state must not be cleared');
    assert.equal(storage.get(storageKey), JSON.stringify(original));
    assert.deepEqual(await readPendingPurchase(scope), original);
  } finally {
    testGlobal.window = previousWindow;
  }
});

test('corrupt pending storage blocks fresh purchase writes instead of being treated as absent', async () => {
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/shop', appVariant: 'kr.masscom.app' });
  const storageKey = pendingPurchaseStorageKey(scope);
  const testGlobal = globalThis as unknown as { window?: unknown };
  const previousWindow = testGlobal.window;
  const storage = new Map<string, string>([[storageKey, '{not-json']]);
  let setCalls = 0;
  testGlobal.window = {
    localStorage: {
      get length() { return storage.size; },
      clear: () => { storage.clear(); },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => { storage.delete(key); },
      setItem: (key: string, value: string) => { setCalls += 1; storage.set(key, value); },
    },
  };
  try {
    await assert.rejects(() => readPendingPurchase(scope), PendingPurchaseStorageError);
    assert.equal(setCalls, 0);
    assert.equal(storage.get(storageKey), '{not-json');
  } finally {
    testGlobal.window = previousWindow;
  }
});
test('empty and JSON null pending storage are corrupt evidence, not absent state', async () => {
  const scope = pendingPurchaseScope({ accountId: 'acct-1', apiUrl: 'https://api.example.test/shop', appVariant: 'kr.masscom.app' });
  const storageKey = pendingPurchaseStorageKey(scope);
  const testGlobal = globalThis as unknown as { window?: unknown };
  const previousWindow = testGlobal.window;
  const storage = new Map<string, string>();
  testGlobal.window = {
    localStorage: {
      get length() { return storage.size; },
      clear: () => { storage.clear(); },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => { storage.delete(key); },
      setItem: (key: string, value: string) => { storage.set(key, value); },
    },
  };
  try {
    storage.set(storageKey, '');
    await assert.rejects(() => readPendingPurchase(scope), PendingPurchaseStorageError);
    storage.set(storageKey, 'null');
    await assert.rejects(() => readPendingPurchase(scope), PendingPurchaseStorageError);
    storage.delete(storageKey);
    assert.equal(await readPendingPurchase(scope), null, 'only physically absent storage is absent pending');
  } finally {
    testGlobal.window = previousWindow;
  }
});