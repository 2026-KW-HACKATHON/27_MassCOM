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

test('the passport page keeps names, status lines and stamp ink readable on the paper', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.stampPage.backgroundColor, world.paper);
    assert.equal(styles.stampPage.borderColor, world.paperLine);
    for (const text of [styles.stampName, styles.stampStatus, styles.stampMystery]) {
      assert.ok(contrast(text.color as string, world.paper) >= 4.5, `${text.color} on paper`);
    }
    assert.ok(contrast(styles.stampMark.color as string, world.paper) >= 4.5, 'stamp ink text');
    assert.equal(styles.stampRing.borderColor, world.stampInk);
    assert.ok(contrast(world.stampInk, world.paper) >= 4.5, 'stamp ring on paper');
    assert.ok((styles.stampSlot.minHeight as number) >= uiMetrics.minTouch);
  }
});
