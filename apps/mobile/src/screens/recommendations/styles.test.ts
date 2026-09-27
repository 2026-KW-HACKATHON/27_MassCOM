import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeRecommendationsStyles } from './styles';

test('makeRecommendationsStyles gives rendered light and dark content and states their palette colors', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeRecommendationsStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.centered.backgroundColor, palette.background);
    assert.equal(styles.centeredTitle.color, palette.label);
    assert.equal(styles.centeredBody.color, palette.secondaryLabel);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.rotationNote.color, palette.secondaryLabel);
    assert.equal(styles.retryButton.backgroundColor, palette.primary);
    assert.equal(styles.inlineError.backgroundColor, palette.errorContainer);
    assert.equal(styles.inlineError.color, palette.onErrorContainer);
  }
});
