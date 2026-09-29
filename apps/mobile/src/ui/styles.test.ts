import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blend, contrast, withAlpha } from '../theme/contrast';
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

test('the back button is a touchable floating disc with a readable glyph and title', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.backButton.backgroundColor, world.card);
    assert.ok((styles.backButton.minWidth as number) >= uiMetrics.minTouch);
    assert.ok((styles.backButton.minHeight as number) >= uiMetrics.minTouch);
    assert.ok(contrast(styles.backGlyph.color as string, world.card) >= 4.5);
    for (const sky of world.sky) assert.ok(contrast(styles.backTitle.color as string, sky) >= 4.5);
  }
});

test('header text sits on a frosted rounded panel that stays readable over any art pixel', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.headerPanel.backgroundColor, withAlpha(world.headerScrim, world.headerScrimAlpha));
    assert.equal(styles.headerPanel.borderRadius, 20);
    assert.ok((styles.headerPanel.paddingVertical as number) >= 12);
    assert.ok((styles.headerPanel.paddingHorizontal as number) >= 16);
    for (const art of ['#000000', '#FFFFFF']) {
      const panel = blend(world.headerScrim, art, world.headerScrimAlpha);
      for (const text of [styles.headerTitle, styles.headerSubtitle, styles.backTitle]) {
        assert.ok(contrast(text.color as string, panel) >= 4.5, `${text.color} over ${art} through the scrim`);
      }
    }
  }
});

test('pressing shows a visible background change that keeps the text readable, even with motion off', () => {
  const visible = (a: string, b: string) => contrast(a, b) >= 1.08;
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    const primary = styles.primaryButtonPressed.backgroundColor as string;
    const secondary = styles.secondaryButtonPressed.backgroundColor as string;
    const card = styles.cardPressed.backgroundColor as string;
    assert.ok(visible(primary, palette.primary), 'primary button');
    assert.ok(visible(secondary, palette.primaryContainer), 'secondary button');
    assert.ok(visible(card, world.card), 'card');
    assert.ok(contrast(palette.onPrimary, primary) >= 4.5, 'primary label when pressed');
    assert.ok(contrast(palette.onPrimaryContainer, secondary) >= 4.5, 'secondary label when pressed');
    assert.ok(contrast(world.cardInk, card) >= 4.5, 'card title when pressed');
    assert.ok(contrast(world.cardMuted, card) >= 4.5, 'card body when pressed');
  }
});
