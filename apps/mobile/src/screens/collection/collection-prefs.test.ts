import assert from 'node:assert/strict';
import { test } from 'node:test';

import { favoritesKey, MAX_FAVORITES, purgeForeignCollectionPrefs, purgeOwnCollectionPrefs, toggleFavorite } from './collection-prefs';

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

// Regression: logout/switch/session-invalidation previously never deleted the outgoing account's own prefs (only a
// later sign-in purged *other* accounts' leftovers), so the same account logging back in silently got its old
// favorites back. purgeOwnCollectionPrefs is what auth-provider now awaits on every auth-ending path.
test('logging out purges the outgoing account own prefs, so re-login starts empty', async () => {
  const alice = favoritesKey('customer-alice');
  const stored = new Set([alice, 'unrelated:setting']);

  const removed = await purgeOwnCollectionPrefs({
    accountId: 'customer-alice',
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async (keys) => {
      for (const key of keys) stored.delete(key);
    },
  });

  assert.equal(removed, 1);
  assert.deepEqual([...stored], ['unrelated:setting']);

  // The same account signing back in has nothing left to purge for itself and nothing foreign either.
  const nextRemoved = await purgeForeignCollectionPrefs({
    accountId: 'customer-alice',
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async () => { throw new Error('unexpected removal'); },
  });
  assert.equal(nextRemoved, 0);
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
