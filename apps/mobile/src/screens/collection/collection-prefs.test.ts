import assert from 'node:assert/strict';
import { test } from 'node:test';

import { favoritesKey, MAX_FAVORITES, purgeForeignCollectionPrefs, toggleFavorite } from './collection-prefs';

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
