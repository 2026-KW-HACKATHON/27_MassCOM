import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
    // The set-up notice sits on the sky page under its header instead of a white sheet.
    assert.equal('backgroundColor' in styles.configurationContent, false);
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
    // The dot only appears with badge data and takes its colour from the medal tier; its outline is tested in passport-chip.test.ts.
    assert.equal('backgroundColor' in styles.passportChipDot, false, 'no meaningless orange dot');
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
    for (const key of ['clearSearch', 'recommendationAction'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
  }
});

test('the search field has a visible 1.5dp boundary against the page and the card (WCAG 1.4.11)', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.ok((styles.searchField.borderWidth as number) >= 1.5);
    assert.equal(styles.searchField.borderColor, world.cardMuted);
    assert.ok(contrast(styles.searchField.borderColor as string, world.page) >= 3, `border on the page ${contrast(styles.searchField.borderColor as string, world.page)}`);
    assert.ok(contrast(styles.searchField.borderColor as string, styles.searchField.backgroundColor as string) >= 3, 'border on the field');
  }
});

test('the store list has no dimming press style (the capacity chip was removed with D-023)', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.equal('cardPressed' in styles, false, 'the dimming press style is gone');
    assert.equal('filterChip' in styles, false, 'no capacity filter chip');
  }
  const source = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /cardPressed/);
});

test('the "지도로 보기" chip beside the passport chip is a 48dp secondary control with readable text', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantListStyles(palette, world);
    assert.ok((styles.mapChip.minHeight as number) >= uiMetrics.minTouch);
    assert.equal(styles.mapChip.backgroundColor, palette.primaryContainer);
    assert.ok(contrast(styles.mapChipText.color as string, styles.mapChip.backgroundColor as string) >= 4.5, 'map chip text');
    // It sits with the passport chip in one wrapping row, so a narrow hero column drops it to the next line instead of clipping.
    assert.equal(styles.chipRow.flexWrap, 'wrap');
  }
});

test('explore links to the map tab from the hero, next to the passport chip', () => {
  const source = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /<Link href="\/map" asChild>/);
  assert.match(source, /accessibilityLabel="지도로 보기, 동네 그림 지도 열기"/);
  assert.match(source, /style=\{styles\.chipRow\}[\s\S]*?<SignedInPassportChip[\s\S]*?<MapChip \/>/);
  assert.match(source, /<TabGlyph name="map"/);
  assert.match(source, />지도로 보기</);
});
