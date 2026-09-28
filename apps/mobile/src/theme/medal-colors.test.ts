import assert from 'node:assert/strict';
import { test } from 'node:test';

import { darkMedalColors, lightMedalColors, medalColorsForScheme, tierColors } from './medal-colors';
import { darkColors, lightColors } from './palette';

const schemes = [
  ['light', lightMedalColors, lightColors],
  ['dark', darkMedalColors, darkColors],
] as const;

test('tier chips keep body-text contrast in both schemes', () => {
  for (const [scheme, medal] of schemes) {
    for (const tier of [1, 2, 3] as const) {
      const colors = tierColors(medal, tier);
      assert.ok(contrast(colors.onContainer, colors.container) >= 4.5, `${scheme} tier ${tier} chip`);
    }
  }
});

test('medal outlines stay visible as UI graphics on page and surface', () => {
  for (const [scheme, medal, palette] of schemes) {
    for (const tier of [1, 2, 3] as const) {
      const { edge } = tierColors(medal, tier);
      assert.ok(contrast(edge, palette.background) >= 3, `${scheme} tier ${tier} edge/background`);
      assert.ok(contrast(edge, palette.surface) >= 3, `${scheme} tier ${tier} edge/surface`);
    }
    assert.ok(contrast(medal.lockedEdge, palette.background) >= 3, `${scheme} locked/background`);
    assert.ok(contrast(medal.lockedEdge, palette.surface) >= 3, `${scheme} locked/surface`);
  }
});

test('passport text reads on every sky gradient stop', () => {
  for (const [scheme, medal, palette] of schemes) {
    for (const stop of medal.sky) {
      assert.ok(contrast(medal.skyInk, stop) >= 4.5, `${scheme} ink/${stop}`);
      assert.ok(contrast(medal.skyMuted, stop) >= 4.5, `${scheme} muted/${stop}`);
      assert.ok(contrast(palette.primary, stop) >= 3, `${scheme} progress/${stop}`);
    }
  }
});

test('the redeemed ink stamp is readable on tickets, surface and page', () => {
  for (const [scheme, medal, palette] of schemes) {
    for (const background of [palette.background, palette.surface, palette.accentContainer]) {
      assert.ok(contrast(medal.stampInk, background) >= 4.5, `${scheme} stamp/${background}`);
    }
  }
});

test('both schemes expose the same colour contract', () => {
  assert.deepEqual(Object.keys(darkMedalColors).sort(), Object.keys(lightMedalColors).sort());
  const hex = /^#[0-9A-F]{6}$/i;
  for (const [, medal] of schemes) {
    for (const tier of [medal.bronze, medal.silver, medal.gold]) {
      for (const value of Object.values(tier)) assert.match(value, hex);
    }
    for (const value of [...medal.sky, ...medal.confetti, medal.stampInk, medal.ribbon, medal.giftPaper]) {
      assert.match(value, hex);
    }
  }
  assert.equal(medalColorsForScheme('dark'), darkMedalColors);
  assert.equal(medalColorsForScheme(null), lightMedalColors);
});

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
