import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrast } from '../theme/contrast';
import { darkColors, lightColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import { darkWorld, lightWorld } from '../theme/world';
import { makeUiStyles } from './styles';

test('floating cards, buttons and headers stay readable and touchable', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.card.backgroundColor, world.card);
    assert.equal(styles.card.borderRadius, world.radius.card);
    assert.ok(contrast(styles.cardTitle.color as string, world.card) >= 4.5);
    assert.ok(contrast(styles.cardBody.color as string, world.card) >= 4.5);
    assert.ok(contrast(styles.primaryButtonText.color as string, styles.primaryButton.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.secondaryButtonText.color as string, styles.secondaryButton.backgroundColor as string) >= 4.5);
    for (const sky of world.sky) {
      assert.ok(contrast(styles.headerTitle.color as string, sky) >= 4.5);
      assert.ok(contrast(styles.headerSubtitle.color as string, sky) >= 4.5);
    }
    for (const key of ['primaryButton', 'secondaryButton', 'avatarButton'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
    assert.ok((styles.avatarButton.minWidth as number) >= uiMetrics.minTouch);
  }
});
