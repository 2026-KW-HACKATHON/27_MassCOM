import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeMerchantListStyles } from './styles';

test('merchant list styles follow the active palette', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeMerchantListStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.primaryAction.backgroundColor, palette.primary);
    assert.equal(styles.inlineErrorText.color, palette.onErrorContainer);
  }
  assert.equal(makeMerchantListStyles(darkColors).content.backgroundColor, '#14171D');
});
