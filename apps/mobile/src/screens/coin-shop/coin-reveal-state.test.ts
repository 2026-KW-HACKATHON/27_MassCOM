import assert from 'node:assert/strict';
import test from 'node:test';
import { coinRevealAccent, nextCoinRevealStage, type CoinRevealStage } from './coin-reveal-state';

test('출처 확인 이후에만 개봉하며 결과는 수동 확인 전까지 유지한다', () => {
  assert.equal(nextCoinRevealStage('source', 'settle'), 'source');
  assert.equal(nextCoinRevealStage('source', 'open'), 'opening');
  assert.equal(nextCoinRevealStage('opening', 'settle'), 'result');
  for (const event of ['open', 'settle', 'skip'] as const) assert.equal(nextCoinRevealStage('result', event), 'result');
});

test('모든 단계에서 건너뛰기는 확정 결과로 이동한다', () => {
  for (const stage of ['source', 'opening', 'result'] as CoinRevealStage[]) {
    assert.equal(nextCoinRevealStage(stage, 'skip'), 'result');
  }
});

test('발행 등급별 연출을 구분하고 알 수 없는 등급을 희귀하다고 추측하지 않는다', () => {
  const grades = ['bronze', 'silver', 'gold', 'prism'].map(coinRevealAccent);
  assert.deepEqual(grades.map((grade) => grade.label), ['브론즈', '실버', '골드', '프리즘']);
  assert.ok(grades.every((grade, index) => index === 0 || grade.duration > grades[index - 1]!.duration));
  assert.equal(coinRevealAccent('special-event').label, '가게 코인');
});
