import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../theme/contrast';
import { darkColors, lightColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import { darkWorld, lightWorld } from '../theme/world';
import { CLAIM_SLOT_FLEX, barHeightFor, tabIndicator } from './tab-bar-style';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('a selected tab differs from an unselected one by more than colour: a pill behind the icon and a bolder label', () => {
  for (const [palette, world] of schemes) {
    const on = tabIndicator(true, palette, world);
    const off = tabIndicator(false, palette, world);
    // Shape: the pill has the same footprint either way (no layout jump) but is only filled when selected.
    assert.equal(on.pill.width, 56);
    assert.equal(on.pill.height, 32);
    assert.equal(on.pill.borderRadius, 16);
    assert.equal(on.pill.backgroundColor, palette.primaryContainer);
    assert.equal(off.pill.width, on.pill.width);
    assert.equal(off.pill.height, on.pill.height);
    assert.notEqual(off.pill.backgroundColor, on.pill.backgroundColor);
    // Weight: the label itself carries the state without any colour.
    assert.equal(on.label.fontWeight, '800');
    assert.notEqual(off.label.fontWeight, on.label.fontWeight);
  }
});

test('the pill is a visible fill and the selected icon and label stay readable on their surfaces', () => {
  for (const [palette, world] of schemes) {
    const on = tabIndicator(true, palette, world);
    const off = tabIndicator(false, palette, world);
    assert.ok(contrast(palette.primaryContainer, world.tabBar) >= 1.1, 'pill fill against the bar');
    // The selected glyph sits on the pill; the label and the unselected glyph sit on the bar.
    assert.ok(contrast(on.iconColor, palette.primaryContainer) >= 4.5, 'selected icon on the pill');
    assert.ok(contrast(on.label.color as string, world.tabBar) >= 4.5, 'selected label on the bar');
    assert.ok(contrast(off.iconColor, world.tabBar) >= 4.5, 'unselected icon on the bar');
    assert.ok(contrast(off.label.color as string, world.tabBar) >= 4.5, 'unselected label on the bar');
  }
});

test('the raised claim stamp shows a ring when it is the selected tab and none otherwise', () => {
  for (const [palette, world] of schemes) {
    const on = tabIndicator(true, palette, world);
    const off = tabIndicator(false, palette, world);
    assert.ok(on.claimRing, 'selected ring');
    assert.equal(off.claimRing, null);
    assert.ok((on.claimRing!.borderWidth as number) >= 2);
    // The ring is drawn inside the primary disc, so it is judged against the disc fill.
    assert.equal(on.claimRing!.borderColor, palette.onPrimary);
    assert.ok(contrast(palette.onPrimary, palette.primary) >= 3, 'ring on the stamp disc');
    assert.equal(on.label.fontWeight, '800');
  }
});

test('the bar grows with text size so the raised button label never touches the bar edge', () => {
  assert.equal(barHeightFor(1), 64);
  assert.equal(barHeightFor(1.1), 64);
  assert.equal(barHeightFor(1.25), 72);
  assert.equal(barHeightFor(1.5), 76);
  assert.equal(barHeightFor(2), 76);
  // Room for the label under the 64dp button: what the bar leaves below the button minus a 2dp gap and a 4dp margin.
  // A Roboto line is about 1.2x the font size, and the label stops growing at 1.5x.
  const LIFT = 22;
  const CLAIM_BUTTON = 64;
  for (const scale of [1, 1.1, 1.15, 1.25, 1.35, 1.49, 1.5, 2]) {
    const labelLine = Math.ceil(12 * Math.min(scale, 1.5) * 1.2);
    const room = barHeightFor(scale) + LIFT - CLAIM_BUTTON - 2 - 4;
    assert.ok(room >= labelLine, `fontScale ${scale}: ${room} < ${labelLine}`);
  }
});

test('with five slots the raised claim slot is wider so "방문 인증" fits at 1.5x text even on a 320dp phone', () => {
  const rowWidth = 320 - 2 * 16;
  const claimSlot = (rowWidth * CLAIM_SLOT_FLEX) / (CLAIM_SLOT_FLEX + 4);
  const otherSlot = rowWidth / (CLAIM_SLOT_FLEX + 4);
  // Four Hangul glyphs and a space at 12sp x 1.5 (the label cap) are about 4.3 em wide.
  assert.ok(claimSlot >= 4.3 * 12 * 1.5, `claim slot ${claimSlot.toFixed(1)}dp`);
  // The two-glyph labels (탐색, 지도, 도감, 친구) keep room next to their 4dp padding, and the slot stays a 48dp target.
  assert.ok(otherSlot - 8 >= 2 * 12 * 1.5, `tab slot ${otherSlot.toFixed(1)}dp`);
  assert.ok(otherSlot >= uiMetrics.minTouch, `tab slot ${otherSlot.toFixed(1)}dp is a touch target`);
  assert.ok(CLAIM_SLOT_FLEX >= 1 && CLAIM_SLOT_FLEX <= 1.6, 'still reads as one of five slots');
});

test('the raised claim stamp is the exact middle of the bar: two equal slots on each side of it', () => {
  // 탐색 · 지도 · (방문 인증) · 도감 · 친구 with flex 1, 1, CLAIM_SLOT_FLEX, 1, 1.
  const flex = [1, 1, CLAIM_SLOT_FLEX, 1, 1];
  const total = flex.reduce((sum, value) => sum + value, 0);
  const beforeClaim = flex[0]! + flex[1]!;
  const afterClaim = flex[3]! + flex[4]!;
  assert.equal(beforeClaim, afterClaim);
  assert.ok(Math.abs((beforeClaim + CLAIM_SLOT_FLEX / 2) / total - 0.5) < 1e-12);
});

const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');

test('the claim slot takes its width from the shared constant', () => {
  assert.match(bar, /claimSlot: \{ flex: CLAIM_SLOT_FLEX/);
  assert.match(bar, /Floating five-slot bar/);
});

test('the tab row is a tablist and label sizes stop at 1.5x', () => {
  assert.match(bar, /accessibilityRole="tablist"/);
  assert.equal((bar.match(/maxFontSizeMultiplier=\{1\.5\}/g) ?? []).length, 2, 'tab label and claim label');
  assert.doesNotMatch(bar, /maxFontSizeMultiplier=\{1\.25\}/);
});

test('the bar surface captures touches and a soft page-coloured mask sits behind it without blocking content', () => {
  // The empty band beside the raised button used to fall through to the list underneath.
  const surface = bar.match(/<View\s+style=\{\[\s*styles\.bar,[\s\S]*?\]\}\s*\/>/)?.[0];
  assert.ok(surface, 'bar surface element');
  assert.doesNotMatch(surface, /pointerEvents/);
  // The mask peeks the page colour through the 16dp gap under and around the bar; it is a gradient and never takes touches.
  assert.match(bar, /<LinearGradient id="barMask"/);
  assert.match(bar, /world\.page/);
  assert.match(bar, /<View pointerEvents="none" style=\{\[styles\.mask/);
});
