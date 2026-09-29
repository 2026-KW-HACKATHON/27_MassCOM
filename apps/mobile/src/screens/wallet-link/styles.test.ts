import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
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
