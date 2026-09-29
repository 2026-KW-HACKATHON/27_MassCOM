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
    assert.equal(styles.couponRow.backgroundColor, palette.background);
    assert.equal(styles.couponTitle.color, palette.label);
    // 되돌리기 카드: 위험 동작은 오류 색 면에, 선택한 사유는 기본 강조 면에 얹는다.
    assert.equal(styles.dangerButton.backgroundColor, palette.errorContainer);
    assert.equal(styles.dangerButtonText.color, palette.onErrorContainer);
    assert.equal(styles.reasonOptionSelected.backgroundColor, palette.primaryContainer);
    assert.equal(styles.reasonOptionTextSelected.color, palette.onPrimaryContainer);
    assert.ok(styles.dangerButton.minHeight >= 48 && styles.reasonOption.minHeight >= 48);
  }
});
