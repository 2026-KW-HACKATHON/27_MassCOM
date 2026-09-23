import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeClaimRedeemStyles } from './styles';

test('claim styles follow the active palette', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeClaimRedeemStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.button.backgroundColor, palette.primary);
    assert.equal(styles.message.color, palette.onPrimaryContainer);
  }
  assert.equal(makeClaimRedeemStyles(darkColors).content.backgroundColor, '#14171D');
});
