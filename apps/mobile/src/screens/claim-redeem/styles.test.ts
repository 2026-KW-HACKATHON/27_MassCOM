import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeClaimRedeemStyles } from './styles';

const schemes = [[lightColors, lightWorld], [darkColors, darkWorld]] as const;

test('claim styles follow the active palette', () => {
  for (const [palette, world] of schemes) {
    const styles = makeClaimRedeemStyles(palette, world);
    assert.equal(styles.button.backgroundColor, palette.primary);
    assert.equal(styles.message.color, palette.onPrimaryContainer);
    assert.equal(styles.input.backgroundColor, palette.background);
  }
});

test('the sky shows through the claim screen instead of a flat page colour', () => {
  for (const [palette, world] of schemes) {
    assert.equal('backgroundColor' in makeClaimRedeemStyles(palette, world).content, false);
  }
});

test('the QR and code panels are dashed stamp cards on world.card with readable guidance', () => {
  for (const [palette, world] of schemes) {
    const styles = makeClaimRedeemStyles(palette, world);
    for (const card of [styles.formCard, styles.previewCard]) assert.equal(card.backgroundColor, world.card);
    assert.equal(styles.formCard.borderStyle, 'dashed');
    assert.equal(styles.formCard.borderColor, world.paperLine);
    assert.ok(contrast(styles.formCard.borderColor as string, world.card) >= 3, 'dashed edge on the card');
    assert.equal(styles.formCard.borderRadius, world.radius.card);
    for (const text of [styles.sectionTitle, styles.securityNote, styles.inputLabel, styles.statusLabel, styles.statusValue]) {
      assert.ok(contrast(text.color as string, world.card) >= 4.5, `${text.color} on card`);
    }
    assert.ok(contrast(styles.heroBubbleText.color as string, styles.heroBubble.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.scanButtonText.color as string, styles.scanButton.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.buttonText.color as string, styles.button.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.collectionButtonText.color as string, styles.collectionButton.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.successBody.color as string, styles.successCard.backgroundColor as string) >= 4.5);
    for (const key of ['button', 'collectionButton'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
  }
});

test('the code input has a visible boundary: 1.5dp, at least 3:1 against the card and its own fill (WCAG 1.4.11)', () => {
  for (const [palette, world] of schemes) {
    const styles = makeClaimRedeemStyles(palette, world);
    assert.ok((styles.input.borderWidth as number) >= 1.5, 'border thickness');
    assert.equal(styles.input.borderColor, world.cardMuted);
    assert.ok(contrast(styles.input.borderColor as string, world.card) >= 3, `border on the card ${contrast(styles.input.borderColor as string, world.card)}`);
    assert.ok(contrast(styles.input.borderColor as string, styles.input.backgroundColor as string) >= 3, 'border on the input fill');
  }
  // The screen must not paint the old faint separator over the style.
  const source = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /borderColor: palette\.separator/);
});
