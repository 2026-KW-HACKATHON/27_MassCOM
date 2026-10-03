import assert from 'node:assert/strict';
import test from 'node:test';

import { gachaAffordability, gachaTimeline, isNewDraw } from './gacha-rules';

const prices = [
  { grade: 'BRONZE' as const, price: 100, total: 3 },
  { grade: 'SILVER' as const, price: 200, total: 3 },
  { grade: 'GOLD' as const, price: 400, total: 3 },
];

test('gacha affordability uses server prices and prioritizes completed grades', () => {
  assert.deepEqual(gachaAffordability(150, prices, { SILVER: 3 }), [
    { grade: 'BRONZE', price: 100, enabled: true },
    { grade: 'SILVER', price: 200, enabled: false, reason: '모두 모았어요' },
    { grade: 'GOLD', price: 400, enabled: false, reason: '250마일리지 부족' },
  ]);
  assert.deepEqual(gachaAffordability(0, [], {}), []);
});

test('new badge depends on ownership before the draw', () => {
  assert.equal(isNewDraw({ id: 'cat' }, ['bear']), true);
  assert.equal(isNewDraw({ id: 'cat' }, ['cat']), false);
});

test('reduced motion removes every staged delay', () => {
  assert.equal(Object.values(gachaTimeline(false)).reduce((a, b) => a + b, 0), 2800);
  assert.deepEqual(Object.values(gachaTimeline(true)), [0, 0, 0, 0, 0, 0, 0]);
});
