import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { collectibleEdgeOffset, collectibleFace } from './collectible-motion';

const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');

test('회전 각도 0°·89°·270°에서는 앞면을 보여준다', () => {
  for (const angle of [0, 89, 270]) assert.equal(collectibleFace(angle), 'front', `${angle}°`);
});

test('회전 각도 91°·180°·-180°에서는 뒷면을 보여준다', () => {
  for (const angle of [91, 180, -180]) assert.equal(collectibleFace(angle), 'back', `${angle}°`);
});

test('모서리 가로 이동은 sin(각도)에 두께를 곱하고 회전 방향을 유지한다', () => {
  const thickness = 12;
  for (const angle of [89, 91, 270]) {
    const expected = Math.sin(angle * Math.PI / 180) * thickness;
    assert.ok(Math.abs(collectibleEdgeOffset(angle, thickness) - expected) < 1e-9, `${angle}°`);
  }
});

test('앞면·뒷면 정면에서는 모서리 가로 이동이 정확히 0이다', () => {
  for (const angle of [0, 180, -180]) assert.equal(collectibleEdgeOffset(angle, 12), 0, `${angle}°`);
});

test('뒷면 그림이 없을 때 기본 뒷면을 사용한다', () => {
  assert.match(detail, /snapshot\.backImageDataUrl\s*\?[\s\S]*?\)\s*:\s*\(\s*<View[\s\S]*?<CollectibleDefaultBack\b/);
});

test('상세 화면의 예전 앞면 갈색 틴트 대체 표현이 제거된다', () => {
  assert.doesNotMatch(detail, /#bf8149/i);
});

test('상세 화면의 수집품 면 접근성 이름에 앞면·뒷면과 수집품 이름을 넣는다', () => {
  assert.match(detail, /accessibilityLabel=\{`\$\{reverse\s*\?\s*'뒷면'\s*:\s*'앞면'\}[^`]*\$\{snapshot\.name\}[^`]*`\}/);
});

test('상세 화면은 각도별 모서리 이동과 등급별 어두운 색을 사용한다', () => {
  assert.match(detail, /collectibleEdgeOffset\(angle,/);
  assert.match(detail, /left:\s*size\s*\*\s*\.09\s*\+\s*depth\s*\*\s*fraction/);
  assert.match(detail, /<CollectibleFaceShape\s+shape=\{snapshot\.shape\}[^>]*fill=\{gradeColors\.shade\}/);
});

test('기본 뒷면의 마스코트 도장은 앱 자산만 사용한다', () => {
  const back = readFileSync(new URL('./collectible-default-back.tsx', import.meta.url), 'utf8');
  assert.match(back, /mascotArt\.stamp/);
  assert.doesNotMatch(back, /\buri\s*:/);
  assert.doesNotMatch(back, /https?:\/\//);
});
