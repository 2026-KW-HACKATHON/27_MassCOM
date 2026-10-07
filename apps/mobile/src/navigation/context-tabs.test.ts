import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextualTab, primaryDestinations } from './context-tabs';

test('contextual tabs keep the five primary destinations in bar order', () => {
  assert.deepEqual(primaryDestinations.map(({ href, label }) => [href, label]), [
    ['/search', '탐색'], ['/collection', '도감'], ['/', '홈'], ['/play-tab', '놀이'], ['/shop', '상점'],
  ]);
});

test('room exploration and coin collection select their source tabs', () => {
  assert.equal(contextualTab('/room-explore'), 0);
  assert.equal(contextualTab('/coin-collection'), 1);
});

test('coin reroll and inventory keep the shop tab selected', () => {
  assert.equal(contextualTab('/coin-shop'), 4);
  assert.equal(contextualTab('/room-inventory'), 4);
});

test('unknown, camera and game routes hide the contextual tab bar', () => {
  for (const path of ['/unknown', '/claim', '/play', '/play-tab', '/camera', '/wallet']) {
    assert.equal(contextualTab(path), null, path);
  }
});
