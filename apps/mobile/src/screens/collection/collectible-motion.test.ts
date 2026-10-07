import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  angleFrameBlend, angleFrameOpacities, collectibleMotionFrame, livingCell, type MotionLike, motionAutoplayObjects, motionAutoplaySequence,
  motionEntrySequence, motionSequenceEnd, onceMotionTypes, particleAt,
} from './collectible-motion';

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

test('각도 프레임 크로스페이드는 아래 칸을 항상 완전 불투명으로 두고 위 칸만 섞는다(WP4 리뷰 4, 아니면 옆면 틴트가 비친다)', () => {
  for (const blend of [0, .3, .5, 1]) {
    assert.deepEqual(angleFrameOpacities(blend), { lower: 1, upper: blend });
  }
  assert.equal(angleFrameOpacities(-1).upper, 0);
  assert.equal(angleFrameOpacities(2).upper, 1);
});

test('once만 있는 시퀀스가 끝나면 멈추고, 설정된 loop 모션이 있으면 그걸로 넘어간다(WP4 리뷰 1)', () => {
  const onceOnly: MotionLike = { type: 'confetti', playback: 'once' };
  assert.deepEqual(motionSequenceEnd([onceOnly], undefined), { action: 'stop' });
  const loop: MotionLike = { type: 'rotate', playback: 'loop' };
  assert.deepEqual(motionSequenceEnd([onceOnly], loop), { action: 'loop', motion: loop });
  // 시퀀스의 마지막이 이미 그 loop 객체 자신이면(연속 재생 중) 더 할 일이 없다.
  assert.deepEqual(motionSequenceEnd([onceOnly, loop], loop), { action: 'hold' });
  assert.deepEqual(motionSequenceEnd([], loop), { action: 'stop' });
});

test('같은 type이어도 once·loop가 서로 다른 파티클이면 객체 단위로 구분해 loop 쪽으로 정확히 넘어간다(WP4 리뷰 6)', () => {
  type MotionWithParticle = MotionLike & { particle: string };
  const onceConfetti: MotionWithParticle = { type: 'confetti', playback: 'once', particle: 'confetti' };
  const loopConfetti: MotionWithParticle = { type: 'confetti', playback: 'loop', particle: 'snow' };
  const end = motionSequenceEnd([onceConfetti], loopConfetti);
  assert.equal(end.action, 'loop');
  assert.equal(end.action === 'loop' ? end.motion.particle : undefined, 'snow');
});

test('motionAutoplayObjects는 motionAutoplaySequence와 같은 순서를 원본 모션 객체로 담는다', () => {
  const motions = [{ type: 'shine', playback: 'once' as const }, { type: 'stamp', playback: 'once' as const }, { type: 'rotate', playback: 'loop' as const }];
  assert.deepEqual(motionAutoplayObjects(motions, true).map((m) => m.type), motionAutoplaySequence(motions, true));
  assert.deepEqual(motionAutoplayObjects(motions, false), [motions[2]]);
});

test('재진입(전경 복귀·동작 줄이기 토글)은 이미 보여준 once 시퀀스를 다시 틀지 않고 loop만 이어간다(WP4 리뷰 3)', () => {
  const motions = [{ type: 'shine', playback: 'once' as const }, { type: 'rotate', playback: 'loop' as const }];
  // 첫 진입(consumed=false)에서 intro면 once+loop를 그대로 보여준다.
  assert.deepEqual(motionEntrySequence(motions, true, false), motionAutoplayObjects(motions, true));
  // 이미 한 번 보여줬다면(consumed=true) intro=true로 재진입해도 loop만 이어간다.
  assert.deepEqual(motionEntrySequence(motions, true, true), [motions[1]]);
  // intro가 아니었던 진입은 원래부터 loop만.
  assert.deepEqual(motionEntrySequence(motions, false, false), [motions[1]]);
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
test('등급 조명은 회전 토글과 별개로 동작하며 카드가 가려지면 센서·시계를 멈춘다', () => {
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  const sensor = readFileSync(new URL('./grade-material-sensor.tsx', import.meta.url), 'utf8');
  assert.match(detail, /const moving = motionAllowed && !reduceMotion && foreground/);
  assert.match(detail, /const materialActive = moving && !scene && cardVisible/);
  assert.match(detail, /<DetailFrame onLayout=\{onViewportLayout\} onScroll=\{onDetailScroll\}>/);
  assert.match(detail, /<View onLayout=\{onCardLayout\} style=\{\[styles\.stage/);
  assert.match(detail, /y < scrollY \+ viewportHeight && y \+ height > scrollY/);
  assert.match(detail, /cardVisibleRef\.current === intersects/);
  assert.match(detail, /canUseTiltSensor && materialActive \? <GradeMaterialSensor/);
  assert.doesNotMatch(detail, /tiltOn[^\n]*<GradeMaterialSensor/);
  assert.match(detail, /Gesture\.Pan\(\)\.activeOffsetX\(\[-16, 16\]\)\.failOffsetY\(\[-6, 6\]\)[\s\S]*\.onUpdate/);
  assert.match(detail, /useDerivedValue\(\(\) => combineMaterialTilt/);
  assert.match(sensor, /useAnimatedSensor\(SensorType\.GRAVITY, \{ interval: 32 \}\)/);
  assert.match(sensor, /frame\.setActive\(false\)/);
  assert.doesNotMatch(sensor, /setInterval|setState|runOnJS|scheduleOnRN/);
});


test('웹 스프라이트 알파도 아래 칸 1과 위 칸 blend를 같은 좌표에서 합성한다', async () => {
  const { angleFrameWebMask } = await import('./collectible-motion');
  const frames = { dataUrl: 'data:image/png;base64,AA==', columns: 4, count: 12, side: 32, stepDegrees: 15 };
  const svg = decodeURIComponent(angleFrameWebMask(frames, 5, 6, .25).split(',').slice(1).join(','));
  assert.match(svg, /viewBox="0 0 1 1"/);
  assert.match(svg, /x="-1" y="-1" width="4" height="3"[^>]*opacity="1"/);
  assert.match(svg, /x="-2" y="-1" width="4" height="3"[^>]*opacity="0.25"/);
  const still = decodeURIComponent(angleFrameWebMask(frames, 5, 6, 0).split(',').slice(1).join(','));
  assert.equal((still.match(/<image /g) ?? []).length, 1);
});
