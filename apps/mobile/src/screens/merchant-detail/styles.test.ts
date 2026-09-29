import assert from 'node:assert/strict';
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
    for (const text of [styles.title, styles.story, styles.heroEyebrow, styles.infoLabel, styles.infoValue, styles.campaignTitle, styles.period, styles.rewardHeading, styles.rewardNote, styles.goalLabel, styles.goalName, styles.nextStepLabel, styles.nextStepText]) {
      const ratio = contrast(text.color as string, world.card);
      assert.ok(ratio >= 4.5, `${text.color} on card ${ratio.toFixed(3)}:1`);
    }
    assert.ok(contrast(styles.demoBadge.color as string, styles.demoBadge.backgroundColor as string) >= 4.5, 'DEMO badge');
    assert.ok(contrast(styles.boundaryTitle.color as string, palette.primaryContainer) >= 4.5);
    assert.ok(contrast(styles.boundaryBody.color as string, palette.primaryContainer) >= 4.5);
    assert.ok(contrast(styles.walletActionText.color as string, styles.walletAction.backgroundColor as string) >= 4.5);
    assert.ok((styles.walletAction.minHeight as number) >= uiMetrics.minTouch);
  }
});
