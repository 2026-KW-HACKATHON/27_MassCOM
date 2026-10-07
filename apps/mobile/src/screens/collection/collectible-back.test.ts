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

test('게시 사진과 각도별 프레임은 앞뒷면 공통 윤곽으로 잘린다', () => {
  assert.match(detail, /function FaceImage\([\s\S]*?overflow: 'hidden', borderRadius:/);
  assert.match(detail, /function FaceImage\([\s\S]*?<ClipPath id=\{clipId\}>[\s\S]*?<CollectibleFaceOutline shape=\{shape\}/);
  assert.match(detail, /clipPath: collectibleWebClipPath\(shape\)/);
  assert.match(detail, /<FaceImage uri=\{snapshot\.backImageDataUrl\} shape=\{snapshot\.shape\}/);
  assert.match(detail, /<FaceImage uri=\{picture\} shape=\{snapshot\.shape\}/);
  assert.match(detail, /<SpriteCell frames=\{snapshot\.angleFrames\}[^>]*shape=\{snapshot\.shape\}/);
  assert.match(detail, /<Image source=\{\{ uri: frames\.dataUrl \}\} resizeMode="stretch"/);
  assert.match(detail, /<ClipPath id=\{lightClipId\}>[\s\S]*?<CollectibleFaceOutline shape=\{snapshot\.shape\}/);
  assert.match(detail, /fill=\"url\(#collectible-light\)\" clipPath=\{Platform\.OS === 'web' \? undefined : `url\(#\$\{lightClipId\}\)`\}/);
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

test('기본 뒷면은 공통 등급 판별과 프리즘 무지개·골드 금속 그라데이션을 쓰고 글자를 패널 위에 둔다', () => {
  const back = readFileSync(new URL('./collectible-default-back.tsx', import.meta.url), 'utf8');
  assert.match(back, /const material = gradeMaterialFor\(gradeId, gradeName\)/);
  assert.match(back, /gradeMaterialPresets\.prism\.rainbowStops/);
  assert.match(back, /gradeMaterialPresets\.gold\.colors/);
  assert.match(back, /<CollectibleFaceShape[^>]*material=\{material\}/);
  assert.match(back, /backgroundColor: colors\.container/);
  assert.match(back, /color: colors\.onContainer/);
});

test('앞면·사용자 뒷면·기본 뒷면은 회전 부모 안에서 같은 조명 입력과 시계를 쓴다', () => {
  assert.equal((detail.match(/<GradeMaterialLayer\b/g) ?? []).length, 3);
  assert.equal((detail.match(/tilt=\{materialTilt\} clock=\{materialClock\}/g) ?? []).length, 3);
  assert.match(detail, /<GradeMaterialLayer material=\{material\} size=\{displayFace\} shape=\{snapshot\.shape\}/);
  assert.match(detail, /clipPath: collectibleWebClipPath\(snapshot\.shape\)/);
  assert.match(detail, /intensityScale=\{animationFrame\.light \? \.9 : 1\}/);
  // 상세는 Modal 안이라 제스처 루트를 다시 둬야 한다(#358: 없으면 개발 빌드는 렌더 오류, 릴리스는 재질·끌기가 빠진다).
  assert.match(detail, /<GestureHandlerRootView style=\{\{ flex: 1 \}\}>\s*<ScrollView/);
});

test('앞면 조명 마스크는 이미지 실패 대체 그림과 각도별 스프라이트 좌표를 따라간다', () => {
  assert.match(detail, /const frontUri = snapshot\.frontImageSource && !imageFailed/);
  assert.match(detail, /faceUri=\{frontUri\} faceMask=\{frontMask\}/);
  assert.match(detail, /<SpriteCellMask frames=\{snapshot\.angleFrames\} index=\{frameBlend\.index\}/);
  assert.match(detail, /<SpriteCellMask frames=\{snapshot\.angleFrames\} index=\{frameBlend\.next\}/);
  assert.match(detail, /width=\{faceSize \* frames\.columns\} height=\{faceSize \* rows\}/);
});
