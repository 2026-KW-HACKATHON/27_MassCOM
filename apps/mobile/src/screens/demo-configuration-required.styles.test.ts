import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../theme/palette';
import { makeDemoConfigurationRequiredStyles } from './demo-configuration-required.styles';

test('makeDemoConfigurationRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeDemoConfigurationRequiredStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.card.backgroundColor, palette.surface);
    assert.equal(styles.code.color, palette.primary);
  }
});
