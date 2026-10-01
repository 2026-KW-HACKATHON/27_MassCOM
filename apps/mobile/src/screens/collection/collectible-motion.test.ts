import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { angleFrameBlend, collectibleMotionFrame, livingCell, motionAutoplaySequence, onceMotionTypes, particleAt } from './collectible-motion';

const vectors = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/collectible-vectors.json', import.meta.url), 'utf8')) as {
  particleAt: { kind: string; i: number; phase: number; expected: { x: number; y: number; color: string } }[];
  angleFrameIndex: { angle: number; expected: { back: boolean; index?: number; next?: number; blend?: number } }[];
};

test('particleAt은 웹 렌더러·Android가 공유하는 벡터와 소수점까지 일치한다', () => {
  for (const { kind, i, phase, expected } of vectors.particleAt) {
    const point = particleAt(kind, i, phase);
    assert.equal(point.x, expected.x, `${kind} i=${i} phase=${phase} x`);
    assert.equal(point.y, expected.y, `${kind} i=${i} phase=${phase} y`);
    assert.equal(point.color, expected.color, `${kind} i=${i} phase=${phase} color`);
  }
});

test('angleFrameBlend는 공유 벡터와 같은 칸·섞음 비율을 내고, |각도|>90은 뒷면으로 표시한다', () => {
  for (const { angle, expected } of vectors.angleFrameIndex) {
    const blend = angleFrameBlend(angle);
    assert.equal(blend.back, expected.back, `angle=${angle} back`);
    if (!blend.back) {
      assert.equal(blend.index, expected.index, `angle=${angle} index`);
      assert.equal(blend.next, expected.next, `angle=${angle} next`);
      assert.equal(blend.blend, expected.blend, `angle=${angle} blend`);
    }
  }
});

test('living 칸은 주기를 돌며, 시계가 0이면(동작 줄이기) 항상 0번 칸이다', () => {
  assert.equal(livingCell(0, 2400, 8), 0);
  assert.equal(livingCell(1199, 2400, 8), 3);
  assert.equal(livingCell(2400, 2400, 8), 0, '한 주기를 꽉 채우면 다시 0번 칸으로 돈다');
  assert.equal(livingCell(2399, 2400, 8), 7);
});

test('모션 자동재생 순서: 획득 직후(intro)는 once를 전부 보여준 뒤 loop, 나중에 열면 loop만 재생한다', () => {
  const motions = [{ type: 'shine', playback: 'once' as const }, { type: 'stamp', playback: 'once' as const }, { type: 'rotate', playback: 'loop' as const }];
  assert.deepEqual(motionAutoplaySequence(motions, true), ['shine', 'stamp', 'rotate']);
  assert.deepEqual(motionAutoplaySequence(motions, false), ['rotate']);
  assert.deepEqual(onceMotionTypes(motions), ['shine', 'stamp']);
  assert.deepEqual(motionAutoplaySequence(undefined, true), []);
  assert.deepEqual(motionAutoplaySequence([{ type: 'confetti', playback: 'once' }], false), [], '한 번만 재생하는 모션뿐이면 나중에 열었을 때는 자동재생하지 않는다');
});

test('저장한 동작은 일반 회전으로 바뀌지 않고 각자의 변화만 적용된다', () => {
  assert.ok(collectibleMotionFrame('rotate', 3000, 320).rotation > 30);
  for (const type of ['still', 'float', 'shine', 'stamp', 'sparkle', 'pulse', 'confetti']) {
    assert.equal(collectibleMotionFrame(type, 600, 320).rotation, 0, type);
  }
  assert.notEqual(collectibleMotionFrame('float', 600, 320).lift, 0);
  assert.notEqual(collectibleMotionFrame('pulse', 600, 320).scale, 1);
  assert.ok(collectibleMotionFrame('stamp', 0, 320).scale > 1);
  assert.equal(collectibleMotionFrame('stamp', 1000, 320).scale, 1);
});

test('빛의 위치는 재생 시간에 반응하고 축하 입자는 짧은 구간에만 보인다', () => {
  assert.equal(collectibleMotionFrame('shine', 1000, 320).light, true);
  assert.equal(collectibleMotionFrame('sparkle', 1000, 320).light, true);
  assert.notEqual(collectibleMotionFrame('shine', 1000, 320).lightX, collectibleMotionFrame('shine', 2000, 320).lightX);
  assert.equal(collectibleMotionFrame('confetti', 1000, 320).particles, true);
  assert.equal(collectibleMotionFrame('confetti', 3000, 320).particles, false);
  assert.equal(collectibleMotionFrame('still', 1000, 320).light, false);
  assert.equal(collectibleMotionFrame('still', 1000, 320).particles, false);
});
