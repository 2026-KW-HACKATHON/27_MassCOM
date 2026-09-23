import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeMerchantDetailStyles } from './styles';

test('merchant detail uses its active palette including loading and error states', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeMerchantDetailStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.centeredState.backgroundColor, palette.background);
    assert.equal(styles.centeredTitle.color, palette.label);
    assert.equal(styles.centeredBody.color, palette.secondaryLabel);
    assert.equal(styles.inlineError.backgroundColor, palette.errorContainer);
    assert.equal(styles.inlineErrorText.color, palette.onErrorContainer);
    assert.equal(styles.walletAction.backgroundColor, palette.primary);
  }
});

test('DEMO disclosure and story remain legible over the rendered hero', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeMerchantDetailStyles(palette);
    for (const text of [styles.demoBadge, styles.story]) {
      const foreground = composite(text.color, styles.hero.backgroundColor, 'opacity' in text ? text.opacity : 1);
      const ratio = contrast(foreground, styles.hero.backgroundColor);
      assert.ok(ratio >= 4.5, `${palette.primary} ${ratio.toFixed(3)}:1`);
    }
  }
});

function composite(foreground: string, background: string, opacity: number): string {
  const channel = (index: number) => {
    const front = Number.parseInt(foreground.slice(index, index + 2), 16);
    const back = Number.parseInt(background.slice(index, index + 2), 16);
    return Math.round(front * opacity + back * (1 - opacity)).toString(16).padStart(2, '0');
  };
  return `#${[1, 3, 5].map(channel).join('')}`;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}
