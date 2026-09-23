import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeMerchantClaimStyles } from './styles';

test('makeMerchantClaimStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeMerchantClaimStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.body.color, palette.secondaryLabel);
    assert.equal(styles.contextCard.backgroundColor, palette.primaryContainer);
    assert.equal(styles.infoLabel.color, palette.onPrimaryContainer);
    assert.equal(styles.formCard.backgroundColor, palette.surface);
    assert.equal(styles.button.backgroundColor, palette.primary);
    assert.equal(styles.buttonText.color, palette.onPrimary);
    assert.equal(styles.errorText.color, palette.onErrorContainer);
  }
});
