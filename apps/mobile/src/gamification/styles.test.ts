import assert from 'node:assert/strict';
import test from 'node:test';

import { darkMedalColors, lightMedalColors } from '../theme/medal-colors';
import { darkColors, lightColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import { makeGamificationStyles } from './styles';

test('passport styles follow the active palette and keep 48dp actions', () => {
  for (const [palette, medal] of [[lightColors, lightMedalColors], [darkColors, darkMedalColors]] as const) {
    const styles = makeGamificationStyles(palette, medal);
    assert.equal(styles.button.backgroundColor, palette.primary);
    assert.equal(styles.buttonText.color, palette.onPrimary);
    assert.equal(styles.sheet.backgroundColor, palette.background);
    assert.equal(styles.medalCard.backgroundColor, palette.surface);
    assert.equal(styles.passportRank.color, medal.skyInk);
    assert.equal(styles.inkStampText.color, medal.stampInk);
    for (const key of ['button', 'secondaryButton', 'ghostButton', 'boxButton'] as const) {
      assert.equal(styles[key].minHeight, uiMetrics.minTouch, key);
    }
    assert.equal(styles.closeButton.width, uiMetrics.minTouch);
    assert.equal(styles.closeButton.height, uiMetrics.minTouch);
  }
});
