import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colorsForScheme, darkColors, lightColors } from './palette';
import { foundationColors } from './foundation';

const contrastPairs = [
  ['label', 'background'],
  ['label', 'surface'],
  ['secondaryLabel', 'background'],
  ['secondaryLabel', 'surface'],
  ['primary', 'background'],
  ['onPrimary', 'primary'],
  ['onPrimaryContainer', 'primaryContainer'],
  ['success', 'background'],
  ['success', 'surface'],
  ['onSuccessContainer', 'successContainer'],
  ['error', 'background'],
  ['error', 'surface'],
  ['onErrorContainer', 'errorContainer'],
  ['onAccentContainer', 'accentContainer'],
] as const;

test('the shared action blue matches the approved light and dark palette', () => {
  assert.equal(lightColors.primary, '#2456D6');
  assert.equal(darkColors.primary, '#9BB8FF');
});

test('presentation colors are aliases of the semantic palette', () => {
  for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
    const foundation = foundationColors[scheme];
    assert.deepEqual(foundation, {
      background: palette.background,
      ink: palette.label,
      muted: palette.secondaryLabel,
      line: palette.separator,
      soft: palette.surface,
      accent: palette.primary,
      tint: palette.primaryContainer,
      onAccent: palette.onPrimary,
    });
  }
});

test('78% white over light action blue falls below body-text contrast', () => {
  assert.ok(contrast(composite('#FFFFFF', lightColors.primary, 0.78), lightColors.primary) < 4.5);
});

test('light and dark palettes expose the same semantic color contract', () => {
  assert.deepEqual(Object.keys(darkColors).sort(), Object.keys(lightColors).sort());
  for (const palette of [lightColors, darkColors]) {
    for (const key of [
      'label', 'secondaryLabel', 'separator', 'background', 'surface',
      'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
      'success', 'successContainer', 'onSuccessContainer',
      'error', 'errorContainer', 'onErrorContainer',
      'accentContainer', 'onAccentContainer',
    ] as const) {
      assert.match(palette[key] ?? '', /^#[0-9A-F]{6}$/i, key);
    }
  }
});

test('body and status foreground pairs meet WCAG 4.5 contrast', () => {
  for (const [scheme, palette] of [['light', lightColors], ['dark', darkColors]] as const) {
    for (const [foreground, background] of contrastPairs) {
      assert.match(palette[foreground] ?? '', /^#[0-9A-F]{6}$/i, foreground);
      assert.match(palette[background] ?? '', /^#[0-9A-F]{6}$/i, background);
      assert.ok(
        contrast(palette[foreground], palette[background]) >= 4.5,
        `${scheme} ${foreground}/${background}`,
      );
    }
  }
});

test('scheme selection is explicit and null defaults to light', () => {
  assert.equal(colorsForScheme(null), lightColors);
  assert.equal(colorsForScheme('light'), lightColors);
  assert.equal(colorsForScheme('dark'), darkColors);
  assert.notEqual(lightColors.background, darkColors.background);
  assert.notEqual(lightColors.surface, darkColors.surface);
});

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: string, background: string, opacity: number): string {
  const channel = (index: number) => {
    const front = Number.parseInt(foreground.slice(index, index + 2), 16);
    const back = Number.parseInt(background.slice(index, index + 2), 16);
    return Math.round(front * opacity + back * (1 - opacity)).toString(16).padStart(2, '0');
  };
  return `#${[1, 3, 5].map(channel).join('')}`;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
