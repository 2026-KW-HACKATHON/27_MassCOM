import assert from 'node:assert/strict';
import { test } from 'node:test';

import { tiltEmittedDegrees, tiltStep } from './collectible-tilt-math';

test('작은 기울임은 2° 데드존 안에서 0으로 눌린다(데드존은 기기로 보내는 값에만 적용된다)', () => {
  // atan2(0, 1) = 0도: 중력이 거의 수직이면 기울임이 없다.
  assert.equal(tiltEmittedDegrees(tiltStep(0, 1, 0)), 0);
  // 아주 살짝 기운 상태를 한 번 적용해도 저역통과 뒤 데드존 안에 남는다.
  assert.equal(tiltEmittedDegrees(tiltStep(0.01, 1, 0)), 0);
});

test('데드존에 눌려도 저역통과 상태는 계속 쌓여, 5°~9° 같은 실제 기울임을 놓치지 않는다(WP4 리뷰 7)', () => {
  for (const degrees of [5, 9]) {
    const radians = degrees * Math.PI / 180;
    let smoothed = 0;
    for (let i = 0; i < 6; i += 1) smoothed = tiltStep(Math.sin(radians), Math.cos(radians), smoothed);
    assert.notEqual(tiltEmittedDegrees(smoothed), 0, `${degrees}도 기울임은 몇 샘플 뒤 데드존을 벗어나야 한다`);
  }
});

test('큰 기울임은 ±30°로 clamp된다', () => {
  // atan2(1, 0) = 90도: 저역통과를 여러 번 적용해 목표치에 충분히 수렴시킨다.
  let smoothed = 0;
  for (let i = 0; i < 50; i += 1) smoothed = tiltStep(1, 0, smoothed);
  assert.equal(smoothed, 30);
  for (let i = 0; i < 50; i += 1) smoothed = tiltStep(-1, 0, smoothed);
  assert.equal(smoothed, -30);
});

test('저역통과는 한 번에 목표치로 뛰지 않고 점진적으로 다가간다', () => {
  const first = tiltStep(1, 1, 0); // atan2(1,1) = 45도 목표
  assert.ok(first > 0 && first < 45, `첫 샘플은 0과 45 사이여야 한다: ${first}`);
  const second = tiltStep(1, 1, first);
  assert.ok(second > first, '반복할수록 목표치에 더 가까워진다');
});

test('기기로 보내는 값은 정수 도(度)로 반올림한다', () => {
  assert.equal(tiltEmittedDegrees(12.6), 13);
  assert.equal(tiltEmittedDegrees(-12.4), -12);
  assert.equal(tiltEmittedDegrees(0), 0);
});
