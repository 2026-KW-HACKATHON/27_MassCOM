import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blend, contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { TILE_BORDER, makeMerchantArtStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('every line of text on a floating card reads at 4.5:1', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    for (const text of [styles.cardTitle, styles.cardBody, styles.quota, styles.disclosure, styles.hint, styles.generatingTitle, styles.generatingBody, styles.tileLabel, styles.tileLabelSelected]) {
      const ratio = contrast(text.color as string, world.card);
      assert.ok(ratio >= 4.5, `${text.color} on card ${ratio.toFixed(2)}:1`);
    }
  }
});

test('the default-stamp note reads on its cream paper and the notices on their containers', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    assert.ok(contrast(styles.currentPlaceholderText.color as string, world.paper) >= 4.5);
    assert.ok(contrast(styles.noticeText.color as string, palette.errorContainer) >= 4.5);
    assert.ok(contrast(styles.failureText.color as string, palette.errorContainer) >= 4.5);
    assert.equal(styles.notice.backgroundColor, palette.errorContainer);
  }
});

test('a chosen draft is marked by a thick border and a check, not by colour alone, and the mark stands out from the card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    assert.ok(TILE_BORDER >= 4, 'thick border');
    assert.equal(styles.tile.borderWidth, TILE_BORDER);
    // The unchosen border is as thick, so choosing never moves the picture; only the chosen one's colour is not the card's.
    assert.equal(styles.tile.borderColor, world.card);
    assert.equal(styles.tileSelected.borderColor, palette.primary);
    assert.ok(contrast(styles.tileSelected.borderColor as string, world.card) >= 3, 'selected border against the card (WCAG 1.4.11)');
    assert.equal(styles.check.backgroundColor, palette.primary);
    assert.ok(contrast(palette.onPrimary, styles.check.backgroundColor as string) >= 4.5, 'check glyph on its badge');
    assert.ok((styles.check.width as number) >= 24 && (styles.check.height as number) >= 24);
  }
});

test('every control is at least 48dp: the draft label row, the notice that dismisses and the owner page card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    for (const control of [styles.tileLabelRow, styles.notice, styles.entryCard]) {
      assert.ok((control.minHeight as number) >= uiMetrics.minTouch);
    }
  }
});

test('the owner page card is legible on the plain owner page it sits on, and its pressed fill keeps the text readable', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    assert.equal(styles.entryCard.backgroundColor, palette.surface);
    assert.ok(contrast(styles.entryTitle.color as string, palette.surface) >= 4.5);
    assert.ok(contrast(styles.entryBody.color as string, palette.surface) >= 4.5);
    assert.ok(contrast(styles.entryChevron.color as string, palette.surface) >= 3);
    const pressed = blend(palette.label, palette.surface, 0.08);
    assert.equal(styles.entryCardPressed.backgroundColor, pressed);
    assert.ok(contrast(styles.entryTitle.color as string, pressed) >= 4.5);
    assert.ok(contrast(styles.entryBody.color as string, pressed) >= 4.5);
    assert.ok(contrast(styles.entryThumbGlyph.color as string, palette.primaryContainer) >= 4.5);
  }
});

test('the sky shows through the page: only the cards have a fill', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantArtStyles(palette, world);
    assert.equal('backgroundColor' in styles.content, false);
    assert.equal(styles.content.paddingHorizontal, uiMetrics.pageInset);
  }
});
