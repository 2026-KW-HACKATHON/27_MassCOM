import assert from 'node:assert/strict';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeMerchantListStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('merchant list styles follow the active palette', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.equal(styles.inlineErrorText.color, palette.onErrorContainer);
  }
});

test('the sky shows through the list instead of a flat page colour', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.equal('backgroundColor' in styles.content, false);
    assert.equal(styles.configurationContent.backgroundColor, palette.background);
  }
});

test('merchant cards float on world.card and keep their text readable in light and dark', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.equal(styles.card.backgroundColor, world.card);
    for (const text of [styles.cardTitle, styles.cardAddress, styles.cardStory, styles.campaignName, styles.cardArrow, styles.crestLetter]) {
      const background = text === styles.crestLetter ? styles.crest.backgroundColor : world.card;
      assert.ok(contrast(text.color as string, background as string) >= 4.5, `${text.color} on ${background}`);
    }
    assert.equal(styles.crest.borderColor, world.stampOrange);
    // The ring sits between the card outside and the paper inside, so it is judged against both.
    assert.ok(contrast(styles.crest.borderColor as string, world.card) >= 3.3, 'crest ring on card');
    assert.ok(contrast(styles.crest.borderColor as string, styles.crest.backgroundColor as string) >= 3, 'crest ring on paper');
    assert.ok(contrast(styles.passportChipDot.backgroundColor as string, styles.passportChip.backgroundColor as string) >= 3.3, 'chip dot on card');
  }
});

test('the passport chip and the sky headings stay readable and touchable', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.ok(contrast(styles.passportChipText.color as string, styles.passportChip.backgroundColor as string) >= 4.5);
    assert.ok((styles.passportChip.minHeight as number) >= uiMetrics.minTouch);
    for (const sky of [world.page, ...world.sky]) {
      assert.ok(contrast(styles.sectionEyebrow.color as string, sky) >= 4.5, 'section title on sky');
      assert.ok(contrast(styles.sectionCount.color as string, sky) >= 4.5, 'section count on sky');
    }
    assert.ok(contrast(styles.recommendationActionText.color as string, styles.recommendationAction.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.noticeText.color as string, styles.notice.backgroundColor as string) >= 4.5);
    for (const key of ['filterChip', 'clearSearch', 'recommendationAction'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
  }
});
