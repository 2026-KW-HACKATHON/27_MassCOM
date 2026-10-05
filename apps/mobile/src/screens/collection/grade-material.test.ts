import assert from 'node:assert/strict';
import { test } from 'node:test';

import { combineMaterialTilt, GOLD_BAND_STOPS, GOLD_WARM_STOPS, gradeMaterialFor, gradeMaterialPresets, PRISM_FOIL_STOPS, RAINBOW_PERIODS, rainbowGradientAt, reflectionAt } from './grade-material';

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
  assert.ok(gold.glintCount >= 4 && gold.glintCount <= 6);
  assert.ok(prism.glintCount >= 8 && prism.glintCount <= 10);
  assert.ok(prism.rainbowStops.length >= 6);
  assert.ok(gold.baseOpacity >= .18 && gold.baseOpacity <= .25);
  assert.equal(prism.baseOpacity, .44);
  assert.equal(silver.intensity, .50);
  assert.equal(gold.intensity, .80);
  assert.equal(prism.intensity, .85);
  for (const preset of [silver, gold, prism]) {
    assert.ok(preset.bandWidth >= .18 && preset.bandWidth <= .24);
    assert.ok(preset.sweepPeriodMs >= 2600 && preset.sweepPeriodMs <= 3400);
    assert.equal(preset.cardPeriodMs, 4000);
  }
});

test('골드 별빛은 전 주기·기울기에서 최소 두 개가 보이고 작은 카드도 상세 광량의 80%를 유지한다', () => {
  const gold = gradeMaterialPresets.gold;
  for (const tiltX of [-1, 0, 1]) for (const tiltY of [-1, 0, 1]) {
    for (let timeMs = 0; timeMs <= gold.sweepPeriodMs; timeMs += 25) {
      const frame = reflectionAt({ tiltX, tiltY, timeMs }, gold);
      assert.ok(frame.glintOpacities.filter((alpha) => alpha >= .55).length >= 2);
      assert.ok(frame.glintOpacities.slice(0, 3).filter((alpha) => alpha * .8 >= .44).length >= 2);
    }
  }
});

test('흰 그림도 골드 바탕·반사띠 가장자리에서 금빛이 남고 좁은 흰 중심은 유지한다', () => {
  // 렌더러와 독립적으로 일반 알파 합성의 흰 픽셀 출력을 계산한다.
  const overWhite = (color: string, alpha: number) => [1, 3, 5].map((offset) =>
    255 * (1 - alpha) + parseInt(color.slice(offset, offset + 2), 16) * alpha);
  for (const color of GOLD_WARM_STOPS) {
    const [r, g, b] = overWhite(color, gradeMaterialPresets.gold.baseOpacity);
    assert.ok(r! > g! && g! > b!, '바탕의 흰색은 따뜻한 금빛으로 바뀐다');
    assert.ok(r! - b! > 20, '흰색 위에서도 금빛 채도 차이가 남는다');
  }
  for (const stop of GOLD_BAND_STOPS.filter(({ offset }) => offset > 0 && offset < 1 && offset !== .5)) {
    const alpha = stop.opacity * gradeMaterialPresets.gold.intensity;
    assert.ok(alpha >= .45 && alpha <= .55, '양쪽 유색 가장자리의 상세 광량');
    const [r, g, b] = overWhite(stop.color, alpha);
    assert.ok(r! > g! && g! > b! && r! - b! > 40, '유색 띠가 밝은 그림에도 구분된다');
  }
  const core = GOLD_BAND_STOPS.find(({ offset }) => offset === .5)!;
  assert.deepEqual(overWhite(core.color, core.opacity), [255, 255, 255]);
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
    if (preset.glintCount > 0) assert.ok(frame.glintOpacities.every((alpha) => alpha > .4));
  }
});

// 렌더러와 별도로 SVG 선형 그라데이션의 투영과 RGB 보간을 계산해 실제 색 연속성을 검사한다.
function foilColorAt(x: number, y: number, phase: number): number[] {
  const { x1, y1, x2, y2 } = rainbowGradientAt(phase);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  assert.ok(t > 0 && t < 1, '카드 안에서 끝 색상이 늘어나지 않는다');
  const stop = t * RAINBOW_PERIODS * (PRISM_FOIL_STOPS.length - 1);
  const index = Math.floor(stop);
  const fraction = stop - index;
  const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const a = rgb(PRISM_FOIL_STOPS[index % 5]!);
  const b = rgb(PRISM_FOIL_STOPS[(index + 1) % 5]!);
  return a.map((channel, i) => channel + (b[i]! - channel) * fraction);
}

test('프리즘 반복 경계 직전·직후의 사진 위 RGB는 작은 오차 안에서 연속이다', () => {
  const preset = gradeMaterialPresets.prism;
  for (const tilt of [{ x: 0, y: 0 }, { x: .7, y: -.4 }, { x: -1, y: 1 }]) {
    const startPhase = .25 + tilt.x * .28 + tilt.y * .18;
    const wrapTime = (1 - startPhase) * preset.sweepPeriodMs;
    const before = reflectionAt({ tiltX: tilt.x, tiltY: tilt.y, timeMs: wrapTime - .01 }, preset);
    const after = reflectionAt({ tiltX: tilt.x, tiltY: tilt.y, timeMs: wrapTime + .01 }, preset);
    assert.ok(before.rainbowPhase > .99 && after.rainbowPhase < .01);
    for (const x of [0, .2, .5, .8, 1]) for (const y of [0, .25, .5, .75, 1]) {
      const a = foilColorAt(x, y, before.rainbowPhase);
      const b = foilColorAt(x, y, after.rainbowPhase);
      assert.ok(a.every((channel, i) => Math.abs(channel - b[i]!) < .001));
    }
  }
});

test('기울기를 강하게 밀어도 반사띠 반복 위치 초기화는 카드 밖에서 일어난다', () => {
  for (const preset of Object.values(gradeMaterialPresets)) {
    for (const tiltX of [-1, 0, 1]) for (const tiltY of [-1, 0, 1]) {
      for (const timeMs of [0, preset.sweepPeriodMs - .01]) {
        const frame = reflectionAt({ tiltX, tiltY, timeMs }, preset);
        const angle = frame.bandAngle * Math.PI / 180;
        const distances = [0, 1].flatMap((x) => [0, 1].map((y) =>
          (x - frame.bandOffset) * Math.cos(angle) + (y - .5) * Math.sin(angle)));
        assert.ok(distances.every((v) => v > preset.bandWidth / 2)
          || distances.every((v) => v < -preset.bandWidth / 2));
      }
    }
  }
});

test('회전·카드 끌기·중력 조명은 합쳐지며 카드 뒤집기 자체를 변경하지 않는다', () => {
  assert.deepEqual(combineMaterialTilt(0, { x: 0, y: 0 }, { x: 0, y: 0 }), { x: 0, y: 0 });
  assert.ok(combineMaterialTilt(45, { x: 0, y: 0 }, { x: 0, y: 0 }).x > 0);
  assert.ok(combineMaterialTilt(0, { x: .6, y: .3 }, { x: 0, y: 0 }).x > 0);
  assert.ok(combineMaterialTilt(0, { x: 0, y: 0 }, { x: -.6, y: -.3 }).y < 0);
  assert.deepEqual(combineMaterialTilt(NaN, { x: Infinity, y: Infinity }, { x: Infinity, y: Infinity }), { x: 1, y: 1 });
});


test('physical tilt holds metal reflections still while input remains unchanged', () => {
  for (const preset of Object.values(gradeMaterialPresets)) {
    const input = { tiltX: .3, tiltY: -.2, ambient: false };
    assert.deepEqual(reflectionAt({ ...input, timeMs: 0 }, preset), reflectionAt({ ...input, timeMs: 40000 }, preset));
    assert.notEqual(reflectionAt({ ...input, timeMs: 40000 }, preset).bandOffset,
      reflectionAt({ ...input, tiltX: -.5, timeMs: 40000 }, preset).bandOffset);
  }
});
