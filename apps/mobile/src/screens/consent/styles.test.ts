import assert from 'node:assert/strict';
import test from 'node:test';

import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { makeConsentStyles } from './styles';

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
