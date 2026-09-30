import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectibleMotionFrame } from './collectible-motion';

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
