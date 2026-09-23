import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageAtOffset } from './foundation-pages';

test('swipe selection follows actual offset and clamps overscroll at both ends', () => {
  assert.equal(pageAtOffset(-35, 390), 0);
  assert.equal(pageAtOffset(780, 390), 2);
  assert.equal(pageAtOffset(975, 390), 3);
  assert.equal(pageAtOffset(900, 390), 2); // cancelled drag back toward the current page
  assert.equal(pageAtOffset(2200, 390), 4);
});

test('page selection is stable across viewport sizes and unmeasured layout', () => {
  for (const width of [320, 390, 412, 768]) assert.equal(pageAtOffset(3 * width, width), 3);
  assert.equal(pageAtOffset(0, 0), 2);
  assert.equal(pageAtOffset(Number.NaN, 390), 2);
});
