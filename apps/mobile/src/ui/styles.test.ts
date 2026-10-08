import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
    assert.equal(styles.stampMark.color, world.stampInk, 'stamps on paper are drawn in stampInk, not the orange accent');
    assert.equal(styles.stampRing.borderColor, world.stampInk);
    assert.ok(contrast(styles.stampPage.borderColor as string, world.paper) >= 3, 'page edge on paper');
    assert.ok(contrast(styles.stampRingEmpty.borderColor as string, world.paper) >= 3, 'empty slot ring on paper');
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

test('state scenes read on the card surface they are drawn on', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.card.backgroundColor, world.card);
    assert.ok(contrast(styles.sceneTitle.color as string, world.card) >= 4.5, 'scene title on card');
    assert.ok(contrast(styles.sceneBody.color as string, world.card) >= 4.5, 'scene body on card');
  }
});

test('a card has a 1px top highlight that only shows in dark, where the card is nearly the page colour', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.cardEdge.borderTopWidth, 1);
    assert.equal(styles.cardEdge.borderTopColor, withAlpha(world.cardEdge, world.cardEdgeAlpha));
    // The edge is a separate style: an edge-specific width on the base card would override a caller's own borderWidth.
    assert.equal('borderTopWidth' in styles.card, false);
  }
  assert.match(makeUiStyles(lightColors, lightWorld).cardEdge.borderTopColor as string, /, 0\)$/, 'light card shows no edge');
  assert.match(makeUiStyles(darkColors, darkWorld).cardEdge.borderTopColor as string, /, 0\.1\)$/);
});

test('the "내 정보" label under the avatar is readable on its own frosted pill over any art pixel, and the avatar stays 48dp', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.avatarLabelPill.backgroundColor, withAlpha(world.headerScrim, world.headerScrimAlpha));
    for (const art of ['#000000', '#FFFFFF']) {
      const pill = blend(world.headerScrim, art, world.headerScrimAlpha);
      assert.ok(contrast(styles.avatarLabel.color as string, pill) >= 4.5, `label over ${art} through the pill ${contrast(styles.avatarLabel.color as string, pill)}`);
    }
    assert.ok((styles.avatarButton.minWidth as number) >= uiMetrics.minTouch);
    assert.ok((styles.avatarButton.minHeight as number) >= uiMetrics.minTouch);
  }
});

test('the caption on a store picture stays readable on its own pill', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.artNote.backgroundColor, world.card);
    assert.ok(contrast(styles.artNoteText.color as string, styles.artNote.backgroundColor as string) >= 4.5, 'picture caption');
  }
});

test('the passport stamp name wraps its disclosure on a real phone (411dp): simple line breaking and a little slack', () => {
  // "더까까주까월계역점" lost its "A" on the Galaxy S24 Ultra: the 800-weight name measured to one line but painted wider, so the wrapped
  // second line fell outside the measured box. Simple breaking makes measuring and painting agree, and the slack absorbs the rest.
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.ok((styles.stampName.paddingHorizontal as number) >= 2, 'horizontal slack on the name');
    assert.equal(styles.stampName.lineHeight, 18);
  }
  const source = readFileSync(fileURLToPath(new URL('./passport-stamp-page.tsx', import.meta.url)), 'utf8');
  const name = source.match(/<Text[^>]*style=\{styles\.stampName\}[^>]*>/)?.[0];
  assert.ok(name, 'the stamp name Text');
  assert.match(name, /textBreakStrategy="simple"/);
  assert.doesNotMatch(name, /numberOfLines=/, 'the non-participation disclosure must not be truncated');
});
