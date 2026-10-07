import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrast } from '../theme/contrast';
import { defaultTabAppearance, parseTabAppearance, tabAppearanceColors } from './tab-appearance';

test('appearance rejects corrupted storage and projects only known preferences', () => {
  assert.deepEqual(parseTabAppearance({ ...defaultTabAppearance, ignored: 'value' }), defaultTabAppearance);
  for (const value of [null, [], {}, { ...defaultTabAppearance, theme: 'other' }]) assert.throws(() => parseTabAppearance(value));
});
test('every saved bar theme and accent keeps readable selected and idle tabs', () => {
  for (const theme of ['mint', 'wood', 'night'] as const) for (const accent of ['mint', 'blue', 'rose'] as const) {
    for (const dark of [false, true]) {
      const colors = tabAppearanceColors({ theme, accent, icons: 'filled' }, dark);
      assert.ok(contrast(colors.active, colors.selected) >= 4.5, `${theme}/${accent}/${dark}`);
      assert.ok(contrast(colors.inactive, colors.background) >= 4.5, `${theme}/${accent}/${dark}`);
    }
  }
});
