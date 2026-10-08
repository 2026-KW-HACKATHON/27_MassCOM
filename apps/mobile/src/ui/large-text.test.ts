import assert from 'node:assert/strict';
import { test } from 'node:test';

import { heroMascotSize, isLargeText, isNarrow } from './large-text';

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

test('a window under 300dp is narrow (browser zoom shrinks the width, not the font scale); an unmeasured 0 is not', () => {
  assert.equal(isNarrow(360), false);
  assert.equal(isNarrow(300), false);
  assert.equal(isNarrow(299), true);
  assert.equal(isNarrow(240), true);
  assert.equal(isNarrow(0), false);
});
