import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COLLECTIBLE_EDGE_GAP, COLLECTIBLE_EDGE_SLOTS, collectibleEdgeGeometry, collectibleEdgeOutline, collectibleEdgeSlots } from './collectible-edge';
import { collectibleEdgeOffset } from './collectible-motion';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('옆면 윤곽은 실제 원형·모서리가 둥근 우표·48점 톱니와 같은 실좌표다', () => {
  const circle = collectibleEdgeOutline('circle', 100);
  assert.equal(circle.length, 96);
  for (const point of circle) close(Math.hypot(point.x - 50, point.y - 50), 46);
  const stamp = collectibleEdgeOutline('stamp', 100);
  close(Math.min(...stamp.map(point => point.x)), 9); close(Math.max(...stamp.map(point => point.x)), 91);
  close(Math.min(...stamp.map(point => point.y)), 4); close(Math.max(...stamp.map(point => point.y)), 96);
  assert.deepEqual(stamp[0], { x: 85, y: 4 });
  const serrated = collectibleEdgeOutline('serrated', 100);
  assert.equal(serrated.length, 48);
  serrated.forEach((point, index) => close(Math.hypot(point.x - 50, point.y - 50), index % 2 ? 36.8 : 46));
  assert.deepEqual(collectibleEdgeOutline('gear', 100), serrated);
  assert.deepEqual(collectibleEdgeOutline('unknown', 100), circle);
});

test('홈 144개는 둘레의 고정 슬롯이고 원의 네 방향과 화면 크기가 바뀌어도 같은 위치를 유지한다', () => {
  const slots = collectibleEdgeSlots(collectibleEdgeOutline('circle', 200));
  assert.equal(slots.length, COLLECTIBLE_EDGE_SLOTS);
  for (const [slot, x, y] of [[0, 100, 8], [36, 192, 100], [72, 100, 192], [108, 8, 100]]) {
    close(slots[slot!]!.x, x!); close(slots[slot!]!.y, y!);
  }
  for (const shape of ['circle', 'stamp', 'serrated']) {
    const small = collectibleEdgeSlots(collectibleEdgeOutline(shape, 200));
    const large = collectibleEdgeSlots(collectibleEdgeOutline(shape, 400));
    small.forEach((slot, index) => {
      assert.equal(slot.slot, index); assert.equal(large[index]!.slot, index);
      close(large[index]!.x, slot.x * 2); close(large[index]!.y, slot.y * 2);
      close(large[index]!.outwardX, slot.outwardX);
    });
  }
});

test('투영 깊이 .35px 이하에서는 홈을 생략하고 얇은 측면의 대비는 낮춘다', () => {
  for (const depth of [0, .1, .35, -.1, -.35]) {
    assert.equal(collectibleEdgeGeometry('circle', 240, .5, depth).grooves.length, 0);
  }
  const thin = collectibleEdgeGeometry('circle', 240, .5, .5);
  const thick = collectibleEdgeGeometry('circle', 240, .5, 3);
  assert.ok(thin.grooves.length > 0);
  assert.ok(thin.darkOpacity < thick.darkOpacity);
  close(thick.darkOpacity, .41); close(thick.highlightOpacity, .41 * .85); close(thick.strokeWidth, .75);
  for (const depth of [.36, .5, 1, 1.99]) {
    const geometry = collectibleEdgeGeometry('circle', 240, .5, depth);
    assert.ok(geometry.darkOpacity < .08 + .33 * (2 - .35) / 2.65);
    assert.ok(geometry.strokeWidth < .75);
  }
});

test('홈은 양·음 회전과 앞·뒷면에서 보이는 측면 방향에만 놓이고 최소 2px 간격이다', () => {
  for (const shape of ['circle', 'stamp', 'serrated']) {
    for (const stageSize of [160, 256, 360]) {
      const faceSize = stageSize * .82;
      const slots = collectibleEdgeSlots(collectibleEdgeOutline(shape, faceSize));
      for (const thickness of [1, 2, 8, 24, 48]) {
        for (const angle of [0, 5, 45, 85, 90, 95, 135, 180, -45, -90, -135]) {
          const depth = collectibleEdgeOffset(angle, thickness * stageSize / 512);
          const horizontal = Math.max(.04, Math.abs(Math.cos(angle * Math.PI / 180)));
          const geometry = collectibleEdgeGeometry(shape, faceSize, horizontal, depth);
          assert.ok(geometry.grooves.length <= COLLECTIBLE_EDGE_SLOTS);
          geometry.grooves.forEach((groove, index) => {
            assert.ok(Math.sign(depth) * slots[groove.slot]!.outwardX > .12);
            close(groove.x2 - groove.x1, depth);
            assert.ok(groove.x1 >= 0 && groove.x1 <= geometry.width);
            assert.ok(groove.x2 >= 0 && groove.x2 <= geometry.width);
            for (const previous of geometry.grooves.slice(0, index)) {
              assert.ok(Math.hypot(groove.x1 - previous.x1, groove.y - previous.y) >= COLLECTIBLE_EDGE_GAP - 1e-8);
            }
          });
        }
      }
    }
  }
});

test('홈 위치는 시간이나 두께에서 다시 생성되지 않고 연속 측면 경계가 음각도에서도 얼굴 오프셋을 유지한다', () => {
  for (const shape of ['circle', 'stamp', 'serrated']) {
    const thin = collectibleEdgeGeometry(shape, 240, .6, 2);
    const thick = collectibleEdgeGeometry(shape, 240, .6, 24);
    assert.deepEqual(thin.grooves.map(({ slot, x1, y }) => ({ slot, x1, y })), thick.grooves.map(({ slot, x1, y }) => ({ slot, x1, y })));
    assert.deepEqual(thick, collectibleEdgeGeometry(shape, 240, .6, 24));
    const reverse = collectibleEdgeGeometry(shape, 240, .6, -24);
    assert.equal(reverse.leftOffset, -24); assert.equal(reverse.width, 264);
    assert.equal(reverse.sidePaths.length, collectibleEdgeOutline(shape, 240).length);
    assert.ok(reverse.sidePaths.every(path => path.startsWith('M') && path.endsWith('Z')));
    assert.ok(reverse.frontPath && reverse.backPath);
  }
});

test('SVG 홈과 재질 바탕은 측면 마스크 안에만 있고 등급 색을 공유하며 저장 자료를 추가하지 않는다', () => {
  const layer = readFileSync(new URL('./collectible-edge-layer.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  assert.match(layer, /geometry\.backPath\} fill="white"/);
  assert.match(layer, /geometry\.frontPath\} fill="black"/);
  assert.match(layer, /<G mask=\{`url\(#\$\{id\}-side\)`\}>[\s\S]*geometry\.grooves\.map/);
  assert.match(layer, /gradeMaterialPresets\.prism\.rainbowStops/);
  assert.match(layer, /gradeMaterialPresets\[material\]\.colors/);
  assert.match(layer, /groove\.y \+ \.6/);
  assert.doesNotMatch(layer, /Image|\.webp|\.png|dataUrl|setInterval|Date\.now|Math\.random/);
  assert.match(detail, /<CollectibleEdgeLayer shape=\{snapshot\.shape\} size=\{displayFace\} horizontal=\{scaleX\} depth=\{depth\}/);
});
