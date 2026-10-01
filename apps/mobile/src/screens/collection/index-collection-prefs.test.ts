import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract checks in the same style as collectible-focus.test.ts, for invariants that live in the screen's
// effect timing rather than in a pure function: React render/focus order is not simulated by this repo's plain
// node:test style, so these assert the guarding code stays in place instead.
const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('leaving the tab closes the acquisition reveal, the detail screen, and invalidates any in-flight link resolution', () => {
  const cleanup = source.slice(source.indexOf('useFocusEffect(useCallback(() => () => {'), source.indexOf('// 대표 진열·마스코트 반응 기록은'));
  assert.match(cleanup, /setCollectibleDetail\(undefined\);/);
  assert.match(cleanup, /setRevealEntitlement\(undefined\);/);
  assert.match(cleanup, /linkGeneration\.current \+= 1;/);
});

test('a favorite tap is ignored until the saved prefs have loaded, so it cannot be overwritten by the late read', () => {
  const toggle = source.slice(source.indexOf('const toggleCollectibleFavorite'), source.indexOf('// Acquisition links'));
  assert.match(toggle, /if \(!prefsLoaded\) return;/);
});

// Light check that the screen drives the reaction queue through mascot-reactions.ts's controller functions rather
// than reimplementing the "one at a time, only the shown one persisted" logic inline; that logic itself is tested
// behaviorally in mascot-reactions.test.ts.
test('the collection screen drives reactions through the queue controller, not an inline reimplementation', () => {
  assert.match(source, /reactionKeyToPersist\(/);
  assert.match(source, /dismissReactionEvent\b/);
  assert.match(source, /currentReactionEvent\(/);
});
