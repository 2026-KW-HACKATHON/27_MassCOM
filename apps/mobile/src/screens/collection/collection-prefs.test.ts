import assert from 'node:assert/strict';
import { test } from 'node:test';

import { favoritesBaseForWrite, favoritesKey, MAX_FAVORITES, parseStoredList, purgeForeignCollectionPrefs, toggleFavorite } from './collection-prefs';

test('storage keys are scoped per account without containing the account ID', () => {
  const key = favoritesKey('customer-alice');
  assert.match(key, /^@masscom:collection:[0-9a-f]{16}:favorites$/);
  assert.equal(key.includes('alice'), false);
  assert.notEqual(favoritesKey('customer-alice'), favoritesKey('customer-bob'));
});

test('toggleFavorite adds and removes a key', () => {
  const withOne = toggleFavorite([], 'pub-1:grade-a');
  assert.deepEqual(withOne, ['pub-1:grade-a']);
  assert.deepEqual(toggleFavorite(withOne, 'pub-1:grade-a'), []);
});

test('toggleFavorite ignores an add past the cap', () => {
  const full = Array.from({ length: MAX_FAVORITES }, (_, index) => `key-${index}`);
  assert.deepEqual(toggleFavorite(full, 'one-more'), full);
  // Removing one already in the list still works even while full.
  assert.deepEqual(toggleFavorite(full, 'key-0'), full.slice(1));
});

test('switching accounts removes only the previous account favorites', async () => {
  const alice = favoritesKey('customer-alice');
  const bob = favoritesKey('customer-bob');
  const stored = new Set([alice, bob, 'unrelated:setting']);

  const removed = await purgeForeignCollectionPrefs({
    accountId: 'customer-bob',
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async (keys) => {
      for (const key of keys) stored.delete(key);
    },
  });

  assert.equal(removed, 1);
  assert.deepEqual([...stored].sort(), [bob, 'unrelated:setting'].sort());
});

// By design, favorites/shown-reactions are per-account data kept on this device: logging out and back in with the
// SAME account restores its own favorites (nothing purges an account's own keys). Only a DIFFERENT account becoming
// current purges what an earlier account left behind (purgeForeignCollectionPrefs, tested above and below).
test('the same account signing back in keeps nothing purged for itself', async () => {
  const alice = favoritesKey('customer-alice');
  const stored = new Set([alice]);

  const removed = await purgeForeignCollectionPrefs({
    accountId: 'customer-alice',
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async () => { throw new Error('unexpected removal'); },
  });
  assert.equal(removed, 0);
  assert.deepEqual([...stored], [alice]);
});

test('parseStoredList treats a missing key, corrupt JSON, and a non-array value as empty instead of throwing', () => {
  assert.deepEqual(parseStoredList(null), []);
  assert.deepEqual(parseStoredList('not json'), []);
  assert.deepEqual(parseStoredList('{"not":"an array"}'), []);
  assert.deepEqual(parseStoredList('"just a string"'), []);
});

test('parseStoredList keeps only string entries from a valid array', () => {
  assert.deepEqual(parseStoredList('["a","b"]'), ['a', 'b']);
  assert.deepEqual(parseStoredList('["a",1,null,"b"]'), ['a', 'b']);
  assert.deepEqual(parseStoredList('[]'), []);
});

// Regression: a slow purgeForeignCollectionPrefs started for account A can still be resolving after the account
// switched again to B; without isStillCurrent it deletes B's just-written keys because they look "foreign" to A.
test('a delayed purge for a since-replaced account never deletes the new account keys', async () => {
  const aliceKey = favoritesKey('customer-alice');
  const bobKey = favoritesKey('customer-bob');
  const stored = new Set([aliceKey, bobKey]);
  let removeCalls = 0;

  const removed = await purgeForeignCollectionPrefs({
    accountId: 'customer-alice',
    listStoredKeys: async () => {
      // Simulates the account having already moved on to bob by the time the listing resolves.
      return [...stored];
    },
    removeStoredKeys: async (keys) => {
      removeCalls += 1;
      for (const key of keys) stored.delete(key);
    },
    isStillCurrent: () => false,
  });

  assert.equal(removed, 0);
  assert.equal(removeCalls, 0);
  assert.deepEqual([...stored].sort(), [aliceKey, bobKey].sort());
});

test('after a failed storage read the first favorite write re-reads, and skips the write if that fails too', async () => {
  let rereads = 0;
  const saved = ['p1:gold'];
  assert.deepEqual(await favoritesBaseForWrite([], true, async () => { rereads += 1; return saved; }), saved);
  assert.equal(await favoritesBaseForWrite([], true, async () => { rereads += 1; return undefined; }), undefined);
  assert.deepEqual(await favoritesBaseForWrite(['a'], false, async () => { rereads += 1; return saved; }), ['a']);
  assert.equal(rereads, 2);
});
