import assert from 'node:assert/strict';
import test from 'node:test';

import { blend, contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { PIN_SIZE, PIN_TOUCH } from './layout';
import { makeTownMapStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('a pin is a 44dp mark inside a 48dp touch target', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    assert.equal(styles.pinDisc.width, PIN_SIZE);
    assert.equal(styles.pinDisc.height, PIN_SIZE);
    assert.equal(PIN_SIZE, 44);
    assert.ok((styles.pinTouch.width as number) >= uiMetrics.minTouch);
    assert.ok((styles.pinTouch.height as number) >= uiMetrics.minTouch);
    assert.equal(styles.pinTouch.width, PIN_TOUCH);
  }
});

test('visited and not-yet pins differ by shape and by a check, not only by colour', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    // Visited: a solid double ring (outer 3dp + inner 1dp), as on the passport. Not yet: one dashed ring.
    assert.equal(styles.pinDiscVisited.borderWidth, 3);
    assert.equal(styles.pinDiscVisited.borderColor, world.stampInk);
    assert.equal(styles.pinInnerRing.borderWidth, 1);
    assert.equal(styles.pinInnerRing.borderColor, world.stampInk);
    assert.equal(styles.pinDiscNone.borderStyle, 'dashed');
    assert.equal('borderStyle' in styles.pinDiscVisited, false);
    assert.ok(styles.pinCheck.width >= 16, 'the check badge is big enough to see');
  }
});

test('pin rings, glyphs and the check keep their contrast on the paper they are drawn on, light and dark', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    assert.equal(styles.pinDisc.backgroundColor, world.paper);
    assert.ok(contrast(styles.pinDiscVisited.borderColor as string, world.paper) >= 3, 'visited ring on paper');
    assert.ok(contrast(styles.pinInnerRing.borderColor as string, world.paper) >= 3, 'inner ring on paper');
    assert.ok(contrast(styles.pinDiscNone.borderColor as string, world.paper) >= 3, 'dashed ring on paper');
    assert.ok(contrast(styles.pinGlyphVisited.color as string, world.paper) >= 4.5, 'visited glyph on paper');
    assert.ok(contrast(styles.pinGlyphNone.color as string, world.paper) >= 4.5, 'not-yet glyph on paper');
    // The check is drawn on the stamp-ink badge, which itself sits on the paper rim.
    assert.ok(contrast(world.paper, styles.pinCheck.backgroundColor as string) >= 4.5, 'check on badge');
    assert.ok(contrast(styles.pinCheck.backgroundColor as string, world.paper) >= 3, 'badge on paper');
  }
});

test('a pressed pin changes its fill, even with motion off, and its glyphs stay readable on the pressed fill', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    const pressed = styles.pinDiscPressed.backgroundColor as string;
    assert.equal(pressed, blend(world.paperInk, world.paper, 0.08));
    assert.ok(contrast(pressed, world.paper) >= 1.08, 'the press is visible');
    assert.ok(contrast(styles.pinGlyphVisited.color as string, pressed) >= 4.5, 'visited glyph while pressed');
    assert.ok(contrast(styles.pinGlyphNone.color as string, pressed) >= 4.5, 'not-yet glyph while pressed');
  }
});

test('the legend explains the two ring shapes in text, on the card they sit on', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    assert.ok(contrast(styles.legendText.color as string, world.card) >= 4.5, 'legend text on card');
    assert.ok(contrast(styles.legendVisited.borderColor as string, world.card) >= 3, 'visited mark on card');
    assert.ok(contrast(styles.legendNone.borderColor as string, world.card) >= 3, 'dashed mark on card');
    assert.equal(styles.legendNone.borderStyle, 'dashed');
    assert.equal(styles.legendVisited.backgroundColor, world.paper);
  }
});

test('the selected halo stands out from the card it is drawn on', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    assert.equal(styles.pinHalo.backgroundColor, world.card);
    assert.ok(contrast(styles.pinHalo.borderColor as string, world.card) >= 3, 'halo ring on card');
  }
});

test('sheet and list text is readable on the card, and the note under the header on the page', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    for (const text of [styles.sheetName, styles.sheetAddress, styles.sheetStatus, styles.sheetGoal, styles.sheetNotice, styles.overflowName, styles.overflowState]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
    for (const sky of [world.page, ...world.sky]) {
      assert.ok(contrast(styles.disclosure.color as string, sky) >= 4.5, 'illustration note on the sky');
      assert.ok(contrast(styles.retryText.color as string, sky) >= 4.5, 'retry text on the sky');
    }
  }
});

test('every control in the sheet and the overflow list is at least 48dp', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    for (const key of ['closeButton', 'overflowRow', 'retry'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
    assert.ok((styles.closeButton.minWidth as number) >= uiMetrics.minTouch);
  }
});

test('the map frame is a rounded card so the art reads as one floating piece', () => {
  for (const [palette, world] of schemes) {
    const styles = makeTownMapStyles(palette, world);
    assert.equal(styles.mapFrame.borderRadius, world.radius.card);
    assert.equal(styles.mapFrame.overflow, 'hidden');
    assert.equal(styles.content.paddingHorizontal, uiMetrics.pageInset);
  }
});
