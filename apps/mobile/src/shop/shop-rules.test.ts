import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShopGradeView } from './shop-api';
import {
  buildFriendGrid,
  earnRulesText,
  formatMileage,
  rerollButtonState,
  rerollDisclosure,
  resumeOrStartPurchase,
  showcaseBonusLabel,
} from './shop-rules';

function grade(overrides: Partial<ShopGradeView> = {}): ShopGradeView {
  return { grade: 'BRONZE', price: 100, total: 3, owned: 1, remaining: 2, probabilityPerItem: 0.5, ...overrides };
}

test('formatMileage adds the P suffix with thousands separators', () => {
  assert.equal(formatMileage(1234), '1,234P');
  assert.equal(formatMileage(0), '0P');
});

test('rerollDisclosure shows the 1/N probability before purchase while items remain', () => {
  assert.equal(rerollDisclosure(grade({ remaining: 2 })), '남은 2종 중 하나를 같은 확률(1/2)로 받아요.');
  assert.equal(rerollDisclosure(grade({ remaining: 1 })), '남은 1종 중 하나를 같은 확률(1/1)로 받아요.');
});

test('rerollDisclosure says the grade is complete once nothing remains', () => {
  assert.equal(rerollDisclosure(grade({ remaining: 0 })), '이 등급의 친구를 모두 모았어요.');
});

test('rerollButtonState disables on a complete grade before checking balance', () => {
  assert.deepEqual(rerollButtonState(grade({ remaining: 0 }), 0), { disabled: true, reason: '모두 모았어요' });
});

test('rerollButtonState disables with the missing amount when balance is short', () => {
  assert.deepEqual(rerollButtonState(grade({ price: 100 }), 40), { disabled: true, reason: '마일리지 60P 부족' });
});

test('rerollButtonState enables once there is remaining stock and enough balance', () => {
  assert.deepEqual(rerollButtonState(grade({ price: 100, remaining: 2 }), 100), { disabled: false });
});

test('earnRulesText reads the weights the server sent, not fixed numbers', () => {
  assert.equal(
    earnRulesText({ visit: 50, newStore: 100, series: 200 }),
    '방문마다 50P, 처음 가는 가게마다 100P, 가게 시리즈를 완성하면 200P를 받아요.',
  );
  assert.match(earnRulesText({ visit: 10, newStore: 20, series: 30 }), /10P.*20P.*30P/s);
});

test('buildFriendGrid marks only the chosen avatar and keeps ownership as-is', () => {
  const items = [
    { id: 'cook-cat', grade: 'BRONZE' as const, name: '요리사 냥이', owned: true },
    { id: 'cafe-bear', grade: 'BRONZE' as const, name: '카페 곰돌이', owned: false },
  ];
  const grid = buildFriendGrid(items, 'cook-cat');
  assert.deepEqual(grid[0], { id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이', owned: true, isAvatar: true });
  assert.equal(grid[1]!.isAvatar, false);
});

test('buildFriendGrid marks no cell as the avatar when none is chosen', () => {
  const grid = buildFriendGrid([{ id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이', owned: true }], null);
  assert.equal(grid[0]!.isAvatar, false);
});

test('resumeOrStartPurchase keeps the same requestId across retries of the same grade', () => {
  let calls = 0;
  const makeId = () => { calls += 1; return `id-${calls}`; };
  const first = resumeOrStartPurchase(undefined, 'BRONZE', makeId);
  assert.deepEqual(first, { grade: 'BRONZE', requestId: 'id-1' });
  const retried = resumeOrStartPurchase(first, 'BRONZE', makeId);
  assert.deepEqual(retried, first, 'a retry of the same grade must not mint a new id');
  assert.equal(calls, 1);
});

test('resumeOrStartPurchase starts a fresh id for a different grade', () => {
  let calls = 0;
  const makeId = () => { calls += 1; return `id-${calls}`; };
  const bronze = resumeOrStartPurchase(undefined, 'BRONZE', makeId);
  const gold = resumeOrStartPurchase(bronze, 'GOLD', makeId);
  assert.notEqual(gold.requestId, bronze.requestId);
  assert.equal(calls, 2);
});

test('showcaseBonusLabel shows only when the server reports a positive bonus', () => {
  assert.equal(showcaseBonusLabel(100_000), '시연 체험 마일리지 포함');
  assert.equal(showcaseBonusLabel(1), '시연 체험 마일리지 포함');
  assert.equal(showcaseBonusLabel(0), null);
  assert.equal(showcaseBonusLabel(undefined), null);
});
