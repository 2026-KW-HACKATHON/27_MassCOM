import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeWalletConfigurationRequiredStyles } from './configuration-required.styles';

test('makeWalletConfigurationRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeWalletConfigurationRequiredStyles(palette);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.badge.backgroundColor, palette.errorContainer);
    assert.equal(styles.badgeText.color, palette.onErrorContainer);
    assert.equal(styles.code.color, palette.primary);
  }
});

test('the sky page shows through the wallet setup notice and its text stays readable on the page and on the card', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeWalletConfigurationRequiredStyles(palette);
    assert.equal('backgroundColor' in styles.content, false);
    // The card is a FloatingCard, which owns the surface, radius, padding and shadow.
    assert.equal('backgroundColor' in styles.card, false);
    assert.equal('borderRadius' in styles.card, false);
    for (const surface of [world.page, world.sky[2]]) {
      for (const text of [styles.title, styles.body, styles.note]) {
        assert.ok(contrast(text.color, surface) >= 4.5, `${text.color} on ${surface}`);
      }
    }
    for (const text of [styles.cardTitle, styles.code]) {
      assert.ok(contrast(text.color, world.card) >= 4.5, `${text.color} on ${world.card}`);
    }
    assert.ok(contrast(styles.badgeText.color, styles.badge.backgroundColor) >= 4.5);
  }
});
