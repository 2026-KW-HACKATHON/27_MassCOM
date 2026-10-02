import assert from 'node:assert/strict';
import { test } from 'node:test';

import { merchantCategories, parseMerchantCategory } from './merchant-categories';

test('keeps the same nine categories, in the same order, as the server CHECK (migration 0036)', () => {
  assert.deepEqual([...merchantCategories], ['한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타']);
});

test('accepts exactly the known categories', () => {
  for (const category of merchantCategories) assert.equal(parseMerchantCategory(category), category);
});

test('turns a missing, empty, unknown or non-string value into null instead of throwing (older or newer servers)', () => {
  for (const value of [undefined, null, '', ' 한식', '한식 ', '프랑스식', 'CAFE', 7, {}, ['한식'], true]) {
    assert.equal(parseMerchantCategory(value), null, String(value));
  }
});
