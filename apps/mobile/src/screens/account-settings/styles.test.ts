import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeAccountSettingsStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('account settings styles follow the active palette', () => {
  for (const [palette, world] of schemes) {
    const styles = makeAccountSettingsStyles(palette, world);
    assert.equal(styles.secondaryLinkText.color, palette.primary);
    assert.equal(styles.error.color, palette.onErrorContainer);
    assert.equal(styles.deleteButton.backgroundColor, palette.errorContainer);
  }
});

test('the sky shows through the settings page and grouped cards float on world.card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeAccountSettingsStyles(palette, world);
    assert.equal('backgroundColor' in styles.content, false);
    for (const card of [styles.profile, styles.groupCard]) {
      assert.equal(card.backgroundColor, world.card);
      assert.equal(card.borderRadius, world.radius.card);
    }
  }
});

test('profile, group titles and deletion notes stay readable on their surfaces', () => {
  for (const [palette, world] of schemes) {
    const styles = makeAccountSettingsStyles(palette, world);
    for (const text of [styles.title, styles.intro, styles.accountDiagnostic, styles.sectionTitle, styles.cardTitle, styles.cardBody]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
    for (const sky of world.sky) assert.ok(contrast(styles.note.color as string, sky) >= 4.5, 'note on sky');
    assert.ok(contrast(styles.deleteButtonText.color as string, styles.deleteButton.backgroundColor as string) >= 4.5);
    for (const key of ['secondaryLink', 'sessionButtonHost'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
  }
});
