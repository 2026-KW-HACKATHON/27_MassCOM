import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { makeAccountSettingsStyles } from './styles';

test('account settings styles follow the active palette', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeAccountSettingsStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.secondaryLinkText.color, palette.primary);
    assert.equal(styles.error.color, palette.onErrorContainer);
  }
  assert.equal(makeAccountSettingsStyles(darkColors).content.backgroundColor, '#14171D');
});
