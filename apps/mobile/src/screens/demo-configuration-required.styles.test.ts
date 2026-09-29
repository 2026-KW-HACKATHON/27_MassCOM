import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../theme/palette';
import { makeDemoConfigurationRequiredStyles } from './demo-configuration-required.styles';

test('makeDemoConfigurationRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeDemoConfigurationRequiredStyles(palette);
    // No page colour of its own: it sits on the sky page inside a tab, and on the stack's own background elsewhere.
    assert.equal('backgroundColor' in styles.content, false);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.card.backgroundColor, palette.surface);
    assert.equal(styles.code.color, palette.primary);
  }
});
