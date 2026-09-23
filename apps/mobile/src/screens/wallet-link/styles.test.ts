import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeWalletLinkStyles } from './styles';

test('makeWalletLinkStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeWalletLinkStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.card.backgroundColor, palette.surface);
    assert.equal(styles.statusLabel.color, palette.secondaryLabel);
    assert.equal(styles.statusValue.color, palette.label);
    assert.equal(styles.message.backgroundColor, palette.primaryContainer);
    assert.equal(styles.messageError.backgroundColor, palette.errorContainer);
    assert.equal(styles.boundaryTitle.color, palette.label);
  }
});

test('wallet status labels and messages remain legible on their rendered containers', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeWalletLinkStyles(palette);
    for (const [foreground, background] of [
      [styles.statusLabel.color, styles.card.backgroundColor],
      [styles.statusValue.color, styles.card.backgroundColor],
      [styles.messageText.color, styles.message.backgroundColor],
      [styles.messageText.color, styles.messageError.backgroundColor],
    ]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${foreground} over ${background}`);
    }
  }
});

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = [1, 3, 5].map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
