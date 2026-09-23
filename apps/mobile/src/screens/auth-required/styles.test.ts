import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeAuthRequiredStyles } from './styles';

test('makeAuthRequiredStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeAuthRequiredStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.statusCard.backgroundColor, palette.surface);
    assert.equal(styles.statusTitle.color, palette.label);
    assert.equal(styles.eyebrow.color, palette.primary);
  }
});
