import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineMaterialTilt, gradeMaterialFor, gradeMaterialPresets, reflectionAt } from './grade-material';

test('등급 id·한국어 이름·특별 별칭은 같은 재질을 고르고 모르는 등급은 브론즈다', () => {
  for (const [id, name, expected] of [
    ['PRISM', '', 'prism'], ['special-2026', '', 'prism'], ['', '특별', 'prism'], ['', '프리즘', 'prism'],
    ['gold', '', 'gold'], ['', '금색', 'gold'], ['', '금등급', 'gold'], ['', '골드', 'gold'],
    ['silver', '', 'silver'], ['', '실버', 'silver'], ['', '은색', 'silver'], ['', '은등급', 'silver'],
    ['bronze', '브론즈', 'bronze'], ['unknown', '알 수 없음', 'bronze'], ['', '', 'bronze'],
    ['gold', '특별', 'prism'],
  ]) assert.equal(gradeMaterialFor(id!, name!), expected);
});

test('골드·프리즘의 강도와 바탕 불투명도는 실버보다 높고 브론즈는 가장 은은하다', () => {
  const { bronze, silver, gold, prism } = gradeMaterialPresets;
  for (const key of ['intensity', 'baseOpacity'] as const) {
    assert.ok(bronze[key] < silver[key]);
    assert.ok(silver[key] < gold[key]);
    assert.ok(silver[key] < prism[key]);
  }
  assert.ok(gold.glintCount >= 3 && gold.glintCount <= 5);
  assert.ok(prism.glintCount >= 6 && prism.glintCount <= 10);
  assert.ok(prism.rainbowStops.length >= 6);
});

test('같은 기울기·시간은 같은 반사 프레임을 재현하고 프리셋을 변경하지 않는다', () => {
  const input = { tiltX: .4, tiltY: -.2, timeMs: 2300 };
  const preset = gradeMaterialPresets.prism;
  const before = JSON.stringify(preset);
  assert.deepEqual(reflectionAt(input, preset), reflectionAt(input, preset));
  assert.equal(JSON.stringify(preset), before);
});

test('범위를 벗어난 기울기·NaN·무한대는 안전한 경계 또는 정면으로 정규화된다', () => {
  const preset = gradeMaterialPresets.gold;
  for (const [bad, safe] of [[20, 1], [-20, -1], [Infinity, 1], [-Infinity, -1], [NaN, 0]]) {
    assert.deepEqual(reflectionAt({ tiltX: bad!, tiltY: bad!, timeMs: 0 }, preset),
      reflectionAt({ tiltX: safe!, tiltY: safe!, timeMs: 0 }, preset));
  }
  for (const timeMs of [NaN, Infinity, -Infinity, -100]) {
    assert.deepEqual(reflectionAt({ tiltX: 0, tiltY: 0, timeMs }, preset),
      reflectionAt({ tiltX: 0, tiltY: 0, timeMs: 0 }, preset));
  }
});

test('프리즘 무지개 위상·반사띠·하이라이트는 두 축 기울기와 시간에 반응한다', () => {
  const preset = gradeMaterialPresets.prism;
  const mid = reflectionAt({ tiltX: 0, tiltY: 0, timeMs: 0 }, preset);
  for (const input of [{ tiltX: .7, tiltY: 0, timeMs: 0 }, { tiltX: 0, tiltY: .7, timeMs: 0 }, { tiltX: 0, tiltY: 0, timeMs: 1200 }]) {
    const moved = reflectionAt(input, preset);
    assert.notEqual(moved.rainbowPhase, mid.rainbowPhase);
    assert.notEqual(moved.bandOffset, mid.bandOffset);
  }
  assert.notEqual(reflectionAt({ tiltX: 0, tiltY: .8, timeMs: 0 }, preset).highlightY, mid.highlightY);
});

test('전체 재질의 프레임은 유한값과 0..1 범위 광량을 낸다', () => {
  for (const preset of Object.values(gradeMaterialPresets)) {
    for (const timeMs of [0, 500, 9000, Number.MAX_VALUE]) {
      const frame = reflectionAt({ tiltX: Infinity, tiltY: NaN, timeMs }, preset);
      assert.ok([frame.bandOffset, frame.bandAngle, frame.rainbowPhase, frame.highlightX, frame.highlightY, ...frame.glintOpacities].every(Number.isFinite));
      assert.ok(frame.rainbowPhase >= 0 && frame.rainbowPhase < 1);
      assert.ok(frame.glintOpacities.every((value) => value >= 0 && value <= 1));
      assert.equal(frame.glintOpacities.length, preset.glintCount);
    }
  }
});

test('비활성·동작 줄이기 프레임은 기울기·시간을 무시하고 반사띠를 중앙에 고정한다', () => {
  for (const preset of Object.values(gradeMaterialPresets)) {
    const frame = reflectionAt({ tiltX: 1, tiltY: -1, timeMs: 9000, active: false }, preset);
    assert.deepEqual(frame, reflectionAt({ tiltX: NaN, tiltY: Infinity, timeMs: Infinity, active: false }, preset));
    assert.equal(frame.bandOffset, .5);
    assert.equal(frame.highlightX, .5);
    assert.equal(frame.highlightY, .42);
  }
});

test('회전·카드 끌기·중력 조명은 합쳐지며 카드 뒤집기 자체를 변경하지 않는다', () => {
  assert.deepEqual(combineMaterialTilt(0, { x: 0, y: 0 }, { x: 0, y: 0 }), { x: 0, y: 0 });
  assert.ok(combineMaterialTilt(45, { x: 0, y: 0 }, { x: 0, y: 0 }).x > 0);
  assert.ok(combineMaterialTilt(0, { x: .6, y: .3 }, { x: 0, y: 0 }).x > 0);
  assert.ok(combineMaterialTilt(0, { x: 0, y: 0 }, { x: -.6, y: -.3 }).y < 0);
  assert.deepEqual(combineMaterialTilt(NaN, { x: Infinity, y: Infinity }, { x: Infinity, y: Infinity }), { x: 1, y: 1 });
});
