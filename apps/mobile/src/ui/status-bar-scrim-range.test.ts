import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrimRange } from './status-bar-scrim-range';

test('the scrim finishes fading in by the time content reaches the status bar text, whatever the inset', () => {
  assert.deepEqual(scrimRange(24), [0, 24]);
  assert.deepEqual(scrimRange(36), [0, 24], 'a tall inset does not delay the fade: header text overlaps the icons after ~20dp of scroll');
  assert.deepEqual(scrimRange(12), [0, 12]);
});

test('a screen with no top inset has nothing to cover', () => {
  assert.deepEqual(scrimRange(0), [0, 0]);
  assert.deepEqual(scrimRange(-3), [0, 0]);
});
