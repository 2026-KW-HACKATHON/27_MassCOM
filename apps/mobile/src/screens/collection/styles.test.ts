import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeCollectionStyles } from './styles';

test('collection styles follow the active palette', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeCollectionStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.centered.backgroundColor, palette.background);
    assert.equal(styles.sectionTitle.color, palette.label);
    assert.equal(styles.mintButton.backgroundColor, palette.primary);
    assert.equal(styles.inlineError.color, palette.onErrorContainer);
  }
  assert.equal(makeCollectionStyles(darkColors).content.backgroundColor, '#14171D');
});
