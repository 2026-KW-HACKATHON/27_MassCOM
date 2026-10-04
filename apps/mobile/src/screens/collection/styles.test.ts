import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeCollectionStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('collection styles follow the active palette', () => {
  for (const [palette, world] of schemes) {
    const styles = makeCollectionStyles(palette, world);
    assert.equal(styles.mintButton.backgroundColor, palette.primary);
    assert.equal(styles.inlineError.color, palette.onErrorContainer);
  }
});

test('the sky shows through the collection instead of a flat page colour', () => {
  for (const [palette, world] of schemes) {
    assert.equal('backgroundColor' in makeCollectionStyles(palette, world).content, false);
  }
});

test('section headings on the sky and floating cards stay readable in light and dark', () => {
  for (const [palette, world] of schemes) {
    const styles = makeCollectionStyles(palette, world);
    for (const sky of [world.page, ...world.sky]) {
      for (const text of [styles.sectionTitle, styles.sectionNote, styles.subsectionTitle]) {
        assert.ok(contrast(text.color as string, sky) >= 4.5, `${text.color} on ${sky}`);
      }
    }
    for (const card of [styles.collectibleCard, styles.visitRow, styles.emptyCopy]) {
      assert.equal(card.backgroundColor, world.card);
    }
    for (const text of [styles.itemTitle, styles.itemMeta, styles.visitMerchant, styles.visitDate, styles.nftLabel, styles.nftValue, styles.emptyCopy]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
    assert.ok((styles.recoveryButton.minHeight as number) >= uiMetrics.minTouch);
  }
});

test('the wallet confirmation label has enough horizontal room in a two-column card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeCollectionStyles(palette, world);
    assert.ok((styles.walletButton.paddingHorizontal as number) <= 6);
    assert.equal(styles.walletButtonText.textAlign, 'center');
  }
});
