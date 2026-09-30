import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract checks in the same style as collectible-focus.test.ts, for invariants that live in the screen's
// effect timing rather than in a pure function: React render/focus order is not simulated by this repo's plain
// node:test style, so these assert the guarding code stays in place instead.
const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('leaving the tab closes the acquisition reveal the same way it closes the detail screen', () => {
  assert.match(
    source,
    /useFocusEffect\(useCallback\(\(\) => \(\) => \{ setCollectibleDetail\(undefined\); setRevealEntitlement\(undefined\); \}, \[setCollectibleDetail, setRevealEntitlement\]\)\);/,
  );
});

test('a favorite tap is ignored until the saved prefs have loaded, so it cannot be overwritten by the late read', () => {
  const toggle = source.slice(source.indexOf('const toggleCollectibleFavorite'), source.indexOf('// Acquisition links'));
  assert.match(toggle, /if \(!prefsLoaded\) return;/);
});
