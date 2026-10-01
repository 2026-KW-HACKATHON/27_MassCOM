import assert from 'node:assert/strict';
import { test } from 'node:test';

import { foldAccessibilityHint, foldAccessibilityLabel, foldToggleText } from './fold-text';

test('the fold label speaks title, summary and expanded state together, not through color alone', () => {
  assert.equal(foldAccessibilityLabel('메달·배지 더보기', '배지 4/9', false), '메달·배지 더보기, 배지 4/9, 접힘');
  assert.equal(foldAccessibilityLabel('메달·배지 더보기', '배지 4/9', true), '메달·배지 더보기, 배지 4/9, 펼쳐짐');
  assert.equal(foldAccessibilityLabel('쿠폰·NFT 발행 현황', undefined, false), '쿠폰·NFT 발행 현황, 접힘');
});

test('the fold hint and visible toggle text flip with the expanded state', () => {
  assert.equal(foldAccessibilityHint(false), '펼치려면 두 번 탭하세요');
  assert.equal(foldAccessibilityHint(true), '접으려면 두 번 탭하세요');
  assert.equal(foldToggleText(false), '더보기 ▼');
  assert.equal(foldToggleText(true), '접기 ▲');
});
