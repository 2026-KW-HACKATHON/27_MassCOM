import assert from 'node:assert/strict';
import { test } from 'node:test';

import { heroMascotSize, isLargeText } from './large-text';

test('text at 150% and above counts as large', () => {
  assert.equal(isLargeText(1), false);
  assert.equal(isLargeText(1.49), false);
  assert.equal(isLargeText(1.5), true);
  assert.equal(isLargeText(2), true);
});

test('a hero mascot keeps its size until the text is large, then shrinks to at most 72dp', () => {
  assert.equal(heroMascotSize(1, 120), 120);
  assert.equal(heroMascotSize(1.3, 112), 112);
  assert.equal(heroMascotSize(1.5, 120), 72);
  assert.equal(heroMascotSize(2, 112), 72);
  assert.equal(heroMascotSize(2, 60), 60, 'never grows a small one');
});
