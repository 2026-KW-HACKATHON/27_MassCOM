import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../theme/contrast';
import { darkColors, lightColors } from '../theme/palette';
import { darkWorld, lightWorld } from '../theme/world';
import { makeDemoConfigurationRequiredStyles } from './demo-configuration-required.styles';

test('makeDemoConfigurationRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeDemoConfigurationRequiredStyles(palette);
    // No page colour of its own: it sits on the sky page inside a tab, and on the stack's own background elsewhere.
    assert.equal('backgroundColor' in styles.content, false);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.code.color, palette.primary);
  }
});

test('the missing-settings card is a FloatingCard and its code stays readable on the card', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeDemoConfigurationRequiredStyles(palette);
    // Surface, radius, padding and shadow come from FloatingCard.
    assert.equal('backgroundColor' in styles.card, false);
    assert.equal('borderRadius' in styles.card, false);
    assert.ok(contrast(styles.code.color, world.card) >= 4.5, `${styles.code.color} on ${world.card}`);
    for (const surface of [world.page, world.sky[2]]) {
      for (const text of [styles.eyebrow, styles.title, styles.body]) {
        assert.ok(contrast(text.color, surface) >= 4.5, `${text.color} on ${surface}`);
      }
    }
  }
});
