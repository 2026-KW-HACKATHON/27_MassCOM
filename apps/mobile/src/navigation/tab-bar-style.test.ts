import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../theme/contrast';
import { uiMetrics } from '../theme/ui-metrics';
import { defaultTabAppearance, tabAppearanceColors } from './tab-appearance';
import { barHeightFor } from './tab-bar-style';

const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');

test('selected tabs have a visible fill and readable icon and label in both schemes', () => {
  for (const dark of [false, true]) {
    const colors = tabAppearanceColors(defaultTabAppearance, dark);
    assert.ok(contrast(colors.selected, colors.background) >= 1.1);
    assert.ok(contrast(colors.active, colors.selected) >= 4.5);
    assert.ok(contrast(colors.inactive, colors.background) >= 4.5);
  }
  assert.match(bar, /backgroundColor: selected \? colors\.selected : 'transparent'/);
  assert.match(bar, /fontWeight: selected \? '800' : '500'/);
});

test('bar grows for large text and limits tab labels to 1.5x', () => {
  assert.deepEqual([1, 1.1, 1.25, 1.5, 2].map(barHeightFor), [64, 64, 72, 76, 76]);
  assert.match(bar, /barHeightFor\(fontScale\)/);
  assert.match(bar, /maxFontSizeMultiplier=\{1\.5\}/);
  assert.doesNotMatch(bar, /maxFontSizeMultiplier=\{1\.25\}/);
});

test('five tabs remain equal touch targets with no raised home slot', () => {
  assert.match(bar, /<View accessibilityRole="tablist"/);
  assert.match(bar, /\{visible\.map\(\(route\) =>/);
  assert.match(bar, /slot: \{ flex: 1, minHeight: uiMetrics\.minTouch, minWidth: uiMetrics\.minTouch/);
  assert.ok(uiMetrics.minTouch >= 44);
  assert.doesNotMatch(bar, /claimSlot|homeLift|raisedHome/);
});

test('bar hides keyboard and game routes and respects prevented tab presses', () => {
  assert.match(bar, /away = keyboardShown \|\| runningGame \|\| !visible\.some/);
  assert.match(bar, /if \(!selected && !event\.defaultPrevented\) \{/);
  assert.match(bar, /navigation\.navigate\(route\.name, route\.params\)/);
});

test('the tab navigator bar steps aside once a stacked screen covers it, so the contextual bar is the only one', () => {
  // The (tabs) screen stays mounted under room-explore, studio and the other stacked screens (display:none on web). A bar drawn
  // there is a second tablist whose selected tab (홈) disagrees with the contextual bar's (탐색 for the neighbours room).
  assert.match(bar, /import \{ useIsFocused \} from 'expo-router';/);
  assert.match(bar, /const rootFocused = useIsFocused\(\);/);
  assert.match(bar, /if \(away \|\| !rootFocused\) return null;/);
  // Screens inside the navigator still size their bottom padding from a footprint that does not flicker with that focus.
  assert.match(bar, /const footprint = away \? 0 : height \+ 12 \+ insets\.bottom;/);
});

test('a page-coloured mask fills the gap under the floating bar so scrolled content cannot show through', () => {
  assert.match(bar, /const gap = Math\.max\(8, insets\.bottom\);/);
  assert.match(bar, /<View pointerEvents="none" style=\{\[styles\.gapMask, \{ height: gap, backgroundColor: worldForScheme\(scheme\)\.page \}\]\} \/>/);
  assert.match(bar, /gapMask: \{ position: 'absolute', left: 0, right: 0, bottom: 0 \}/);
  // The bar sits exactly on top of the mask, and the mask is drawn first so the bar stays above it.
  assert.match(bar, /style=\{\[styles\.bar, \{ bottom: gap, height, backgroundColor: colors\.background \}\]\}/);
  assert.ok(bar.indexOf('styles.gapMask') < bar.indexOf('accessibilityRole="tablist"'));
});
