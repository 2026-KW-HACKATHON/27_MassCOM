import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeMerchantDetailStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('merchant detail keeps its semantic action and error colours in both schemes', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantDetailStyles(palette, world);
    assert.equal(styles.inlineError.backgroundColor, palette.errorContainer);
    assert.equal(styles.inlineErrorText.color, palette.onErrorContainer);
    assert.equal(styles.walletAction.backgroundColor, palette.primary);
    assert.equal(styles.directionsAction.backgroundColor, palette.primary);
    assert.equal(styles.boundaryCard.backgroundColor, palette.primaryContainer);
  }
});

test('the sky shows through the detail page and every panel floats on world.card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantDetailStyles(palette, world);
    assert.equal('backgroundColor' in styles.content, false);
    // The store picture is the BackHeader's own background now; the page no longer stacks a second 240dp banner under the header.
    assert.equal('banner' in styles, false);
    for (const card of [styles.hero, styles.infoCard, styles.rewardCard, styles.nextStep]) {
      assert.equal(card.backgroundColor, world.card);
      assert.equal(card.borderRadius, world.radius.card);
    }
  }
});

test('title, story and DEMO disclosure stay legible on the floating hero card', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantDetailStyles(palette, world);
    for (const text of [styles.title, styles.story, styles.heroEyebrow, styles.infoLabel, styles.infoValue, styles.campaignTitle, styles.period, styles.rewardHeading, styles.previewLabel, styles.previewState, styles.fallbackGoal, styles.progressLine, styles.directionsNotice, styles.nextStepLabel, styles.nextStepText]) {
      const ratio = contrast(text.color as string, world.card);
      assert.ok(ratio >= 4.5, `${text.color} on card ${ratio.toFixed(3)}:1`);
    }
    assert.ok(contrast(styles.demoBadge.color as string, styles.demoBadge.backgroundColor as string) >= 4.5, 'DEMO badge');
    assert.ok(contrast(styles.boundaryTitle.color as string, palette.primaryContainer) >= 4.5);
    assert.ok(contrast(styles.boundaryBody.color as string, palette.primaryContainer) >= 4.5);
    assert.ok(contrast(styles.walletLinkText.color as string, palette.primaryContainer) >= 4.5);
    assert.ok(contrast(styles.walletActionText.color as string, styles.walletAction.backgroundColor as string) >= 4.5);
    assert.ok((styles.walletAction.minHeight as number) >= uiMetrics.minTouch);
    assert.ok(contrast(styles.directionsText.color as string, styles.directionsAction.backgroundColor as string) >= 4.5);
    assert.ok((styles.directionsAction.minHeight as number) >= uiMetrics.minTouch);
  }
});

test('real detail labels are stacked and photos reserve height', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /function Line\(/);
  assert.match(source, /height:170/);
  assert.match(source, /height:120/);
  assert.match(source, /점주 제공 실제 사진/);
});

test('visitor feedback counts remain legible and its action meets the touch target', () => {
  for (const [palette, world] of schemes) {
    const styles = makeMerchantDetailStyles(palette, world);
    assert.equal(styles.feedbackCard.backgroundColor, world.card);
    assert.ok(contrast(styles.feedbackHeading.color, world.card) >= 4.5);
    assert.ok(contrast(styles.feedbackEmpty.color, world.card) >= 4.5);
    assert.ok(contrast(styles.feedbackTagText.color, styles.feedbackTag.backgroundColor) >= 4.5);
    assert.ok(contrast(styles.feedbackActionText.color, styles.feedbackAction.backgroundColor) >= 4.5);
    assert.ok(styles.feedbackAction.minHeight >= uiMetrics.minTouch);
  }
});
