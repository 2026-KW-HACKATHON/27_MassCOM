import assert from 'node:assert/strict';
import { test } from 'node:test';

import { merchantCategories, normalizeCategory, normalizeNeighborhood } from './merchant-profile-rules.js';

test('동네는 한글로 시작해 동·가·리로 끝나는 행정동 이름(2~10자)만 받는다', () => {
  for (const valid of ['월계동', '월계1동', '상계3·4동', '종로1가', '관철동', '하계리', '공릉2동']) {
    assert.equal(normalizeNeighborhood(valid), valid, valid);
  }
  assert.equal(normalizeNeighborhood('  월계동 '), '월계동');
  for (const invalid of [
    '서울 노원구 월계로 1', '월계로 12', '월계 동', 'Wolgye-dong', '월계', '동', '1월계동', '월계동1',
    '월계123동', '가나다라마바사아자차동', '월계-동', '월계.1동', '월계동​', 42, {}, undefined,
  ]) {
    assert.equal(normalizeNeighborhood(invalid), undefined, String(invalid));
  }
  assert.equal(normalizeNeighborhood(''), null);
  assert.equal(normalizeNeighborhood('   '), null);
  assert.equal(normalizeNeighborhood(null), null);
});

test('업종은 고정 목록 아홉 개 중 하나만 받는다', () => {
  assert.deepEqual([...merchantCategories], ['한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타']);
  for (const category of merchantCategories) assert.equal(normalizeCategory(` ${category} `), category);
  for (const invalid of ['KOREAN', '한식당', '편의점', 1, undefined]) assert.equal(normalizeCategory(invalid), undefined);
  assert.equal(normalizeCategory(''), null);
  assert.equal(normalizeCategory(null), null);
});
