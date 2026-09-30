import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { consentBoxSize, makeConsentStyles } from './styles';

test('consent styles use the light and dark palette and keep contrasting button text', () => {
  for (const palette of [lightColors, darkColors]) {
    const styles = makeConsentStyles(palette);
    assert.equal(styles.content.backgroundColor, palette.background);
    assert.equal(styles.title.color, palette.label);
    assert.equal(styles.noticeCard.backgroundColor, palette.surface);
    assert.equal(styles.submit.backgroundColor, palette.primary);
    assert.equal(styles.submitText.color, palette.onPrimary);
    assert.equal(styles.boxChecked.backgroundColor, palette.primary);
    assert.equal(styles.tick.color, palette.onPrimary);
  }
});

test('touch targets are at least 48dp and nothing fixes a height, so 200% text can grow', () => {
  const styles = makeConsentStyles(lightColors) as Record<string, Record<string, unknown>>;
  assert.ok(uiMetrics.minTouch >= 48);
  for (const name of ['checkRow', 'link', 'secondary']) {
    assert.ok((styles[name]!.minHeight as number) >= 48, name);
  }
  assert.ok((styles.submit!.minHeight as number) >= 48);
  for (const [name, style] of Object.entries(styles)) {
    assert.equal('height' in style && name !== 'box', false, `${name} must not fix its height`);
    if (typeof style.fontSize === 'number') assert.ok(typeof style.lineHeight === 'number', `${name} needs a line height`);
  }
});

test('the check box is 28dp at normal text and grows in proportion up to 2.5x, never below 28', () => {
  assert.equal(consentBoxSize(1), 28);
  assert.equal(consentBoxSize(1.3), 36);
  assert.equal(consentBoxSize(2), 56, '200% text');
  assert.equal(consentBoxSize(3), 70, 'capped so the row stays on screen');
  assert.equal(consentBoxSize(0.85), 28);
  assert.equal(consentBoxSize(Number.NaN), 28);
  const box = makeConsentStyles(lightColors).box as Record<string, unknown>;
  assert.equal('width' in box || 'height' in box, false, 'the base style fixes no size; the screen passes the scaled one');
  assert.equal(box.minWidth, 28);
});
