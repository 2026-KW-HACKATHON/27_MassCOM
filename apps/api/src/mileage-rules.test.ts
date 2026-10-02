import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MILEAGE_CATALOG,
  MILEAGE_GRADE_PRICES,
  canSetAvatar,
  chooseUniform,
  computeEarnedMileage,
  decideReroll,
  findCatalogItem,
  isMileageGrade,
  itemsOfGrade,
} from './mileage-rules.js';

test('catalog has exactly 9 items, 3 per grade, with the owner-chosen ids/names/prices', () => {
  assert.equal(MILEAGE_CATALOG.length, 9);
  for (const grade of ['BRONZE', 'SILVER', 'GOLD'] as const) {
    assert.equal(itemsOfGrade(grade).length, 3);
  }
  assert.deepEqual(MILEAGE_GRADE_PRICES, { BRONZE: 100, SILVER: 200, GOLD: 400 });
  assert.equal(findCatalogItem('cook-cat')?.name, '요리사 냥이');
  assert.equal(findCatalogItem('laundry-seal')?.grade, 'GOLD');
  assert.equal(findCatalogItem('unknown-item'), undefined);
  assert.equal(new Set(MILEAGE_CATALOG.map((item) => item.id)).size, 9, 'ids must be unique');
});

test('isMileageGrade accepts only the three known grades', () => {
  assert.equal(isMileageGrade('BRONZE'), true);
  assert.equal(isMileageGrade('SILVER'), true);
  assert.equal(isMileageGrade('GOLD'), true);
  assert.equal(isMileageGrade('PLATINUM'), false);
  assert.equal(isMileageGrade(undefined), false);
});

// 중복 방문·자기 적립·취소·되살리기는 countedVisitFromSql/countedVisitFilterSql이 이미 걸러낸 뒤의 값만
// 이 공식에 들어온다(postgres/badge-rewards.ts 재사용, badge-rewards.postgres.integration.ts가 그 필터를 증명한다).
// 여기서는 걸러진 결과 수치에 대해 공식 자체(가중치·합산)만 고정한다.
test('computeEarnedMileage applies the 50/100/200 weights from already-counted inputs', () => {
  assert.equal(computeEarnedMileage({ countedVisits: 0, distinctMerchants: 0, completedSeries: 0 }), 0);
  // 같은 날 중복 방문은 SQL이 progress_counted=false로 걸러 countedVisits에 들어오지 않는다: 3일 중 2일만 세진 경우.
  assert.equal(computeEarnedMileage({ countedVisits: 2, distinctMerchants: 1, completedSeries: 0 }), 200);
  // 직원 자기 적립은 countedVisitFilterSql이 실제 점포에서 제외한다: 서로 다른 점포 2곳, 방문 3건만 셈.
  assert.equal(computeEarnedMileage({ countedVisits: 3, distinctMerchants: 2, completedSeries: 0 }), 350);
  // 되돌리기로 반려된 뒤 같은 날 다른 방문이 승격돼도(promoted_by_visit_event_id) countedVisits 총량은 그대로다.
  assert.equal(computeEarnedMileage({ countedVisits: 5, distinctMerchants: 3, completedSeries: 1 }), 750);
});

test('chooseUniform only ever returns an item from the given list and validates the injected index', () => {
  const items = ['a', 'b', 'c'];
  for (let forced = 0; forced < items.length; forced++) {
    assert.equal(chooseUniform(items, () => forced), items[forced]);
  }
  assert.throws(() => chooseUniform([], () => 0), RangeError);
  assert.throws(() => chooseUniform(items, () => 3), RangeError, 'out of bound index must be rejected');
  assert.throws(() => chooseUniform(items, () => -1), RangeError);
  assert.throws(() => chooseUniform(items, () => 1.5), RangeError, 'non-integer index must be rejected');
});

test('chooseUniform picks only among the unowned set passed in (caller filters ownership first)', () => {
  const owned = new Set(['cook-cat', 'cafe-bear']);
  const unowned = itemsOfGrade('BRONZE').filter((item) => !owned.has(item.id));
  assert.deepEqual(unowned.map((item) => item.id), ['walk-rabbit']);
  assert.equal(chooseUniform(unowned, () => 0).id, 'walk-rabbit');
});

test('canSetAvatar allows null (no avatar) and only owned items', () => {
  const owned = new Set(['cook-cat']);
  assert.equal(canSetAvatar(null, owned), true);
  assert.equal(canSetAvatar('cook-cat', owned), true);
  assert.equal(canSetAvatar('cafe-bear', owned), false, 'avatar must be owned');
  assert.equal(canSetAvatar('unknown-item', owned), false);
});

const base = {
  existingRequest: undefined,
  grade: 'BRONZE' as const,
  withinRateLimit: true,
  expectedRemaining: 2,
  actualRemaining: 2,
  balance: 100,
  price: 100,
};

test('decideReroll: replaying the same requestId with the same grade never re-checks anything else', () => {
  assert.deepEqual(
    decideReroll({ ...base, existingRequest: { grade: 'BRONZE' }, balance: 0, actualRemaining: 0 }),
    { kind: 'REPLAY' },
  );
});

test('decideReroll: same requestId reused with a different grade is a conflict', () => {
  assert.deepEqual(
    decideReroll({ ...base, existingRequest: { grade: 'SILVER' } }),
    { kind: 'REQUEST_CONFLICT' },
  );
});

test('decideReroll: a brand-new request is rate limited before any other check', () => {
  assert.deepEqual(decideReroll({ ...base, withinRateLimit: false }), { kind: 'RATE_LIMITED' });
});

test('decideReroll: expectedRemaining mismatch is reported before completeness/balance', () => {
  assert.deepEqual(
    decideReroll({ ...base, expectedRemaining: 3, actualRemaining: 0, balance: 0 }),
    { kind: 'STATE_CHANGED' },
  );
});

test('decideReroll: a fully-owned grade is GRADE_COMPLETE once remaining checks out', () => {
  assert.deepEqual(
    decideReroll({ ...base, expectedRemaining: 0, actualRemaining: 0 }),
    { kind: 'GRADE_COMPLETE' },
  );
});

test('decideReroll: insufficient balance is reported only after completeness passes', () => {
  assert.deepEqual(decideReroll({ ...base, balance: 99 }), { kind: 'INSUFFICIENT_MILEAGE' });
});

test('decideReroll: proceeds once every earlier check passes', () => {
  assert.deepEqual(decideReroll({ ...base, balance: 100 }), { kind: 'PROCEED' });
  assert.deepEqual(decideReroll({ ...base, balance: 150 }), { kind: 'PROCEED' });
});
