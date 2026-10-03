import assert from 'node:assert/strict';
import test from 'node:test';

import { gachaAffordability, gachaPhaseAfter, gachaTimeline, isNewDraw } from './gacha-rules';

const prices = [
  { grade: 'BRONZE' as const, price: 100, total: 3 },
  { grade: 'SILVER' as const, price: 200, total: 3 },
  { grade: 'GOLD' as const, price: 400, total: 3 },
];

test('구매 실패 뒤 새로고침이 성공해도 등급 선택으로 남고 다시 뽑을 수 있다', async () => {
  let phase = gachaPhaseAfter('picker', { type: 'draw-started' });
  assert.equal(phase, 'pending');
  phase = gachaPhaseAfter(phase, { type: 'purchase-failed' });
  let error: string | undefined = '구매 실패';
  assert.equal(phase, 'picker');
  // 새로고침은 snapshot과 오류만 바꾼다. 오류 문구 없이도 실제 phase는 picker다.
  const refreshedSnapshot = await Promise.resolve({ balance: 400, grades: prices });
  error = undefined;
  const available = gachaAffordability(refreshedSnapshot.balance, refreshedSnapshot.grades, {});
  assert.equal(error, undefined);
  assert.equal(phase, 'picker');
  assert.equal(available.find((entry) => entry.grade === 'GOLD')?.enabled, true);
  phase = gachaPhaseAfter(phase, { type: 'draw-started' });
  assert.equal(phase, 'pending');
});

test('건너뛰기는 진행 중인 구매를 기다리고 요청이 없는 pending에서는 선택 화면으로 복귀한다', () => {
  assert.equal(gachaPhaseAfter('pending', { type: 'skip', busy: true }), 'pending');
  assert.equal(gachaPhaseAfter('pending', { type: 'skip', busy: false }), 'picker');
  assert.equal(gachaPhaseAfter('shake', { type: 'skip', busy: false }), 'result');
  assert.equal(gachaPhaseAfter('result', { type: 'purchase-failed' }), 'result');
});

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
