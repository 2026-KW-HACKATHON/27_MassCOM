import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./grade-material-layer.tsx', import.meta.url), 'utf8');

test('등급 조명은 사진 알파 또는 공통 윤곽 안에만 그린다', () => {
  assert.match(source, /const maskUri = webFaceMask \?\? faceUri/);
  assert.match(source, /maskImage: `url\(\$\{JSON\.stringify\(maskUri\)\}\)`/);
  assert.match(source, /clipPath: collectibleWebClipPath\(shape\)/);
  assert.match(source, /<Mask id=\{maskId\} maskType="alpha">/);
  assert.match(source, /faceUri \? <SvgImage/);
  assert.match(source, /<CollectibleFaceOutline shape=\{shape\} fill="white" \/>/);
  assert.match(source, /<G clipPath=\{Platform\.OS === 'web' \? undefined : `url\(#\$\{clipId\}\)`\} mask=\{Platform\.OS === 'web' \? undefined : `url\(#\$\{maskId\}\)`\}>/);
});

test('시계는 화면·동작 상태가 바뀔 때 중단하고 정적 프레임은 반복을 만들지 않는다', () => {
  assert.match(source, /useFrameCallback\([\s\S]*?\}, false\)/);
  assert.match(source, /frameCallback\.setActive\(active && motionEnabled && foreground\)/);
  assert.match(source, /return \(\) => frameCallback\.setActive\(false\)/);
  assert.match(source, /return <AutonomousLayer/);
  assert.match(source, /if \(!moving\) return <StaticLayer \{\.\.\.props\} tilt=\{undefined\} moving=\{false\} \/>/);
  assert.ok(source.indexOf('if (!moving)') < source.indexOf('if (props.clock)'), '정적 카드는 외부 목록 시계보다 먼저 분기한다');
  assert.match(source, /importantForAccessibility="no-hide-descendants"/);
});

test('반사 계산은 재질 레이어당 한 번만 파생해 그라데이션과 별빛이 공유한다', () => {
  assert.equal((source.match(/reflectionAt\(/g) ?? []).length, 1);
  assert.match(source, /const reflection = useDerivedValue\(/);
  assert.match(source, /reflection=\{reflection\}/);
});

test('뒷면은 사진과 같은 회전 조명에 골드·프리즘 별빛을 더하고 앞면의 기존 표시를 유지한다', () => {
  assert.match(source, /showGlints = false/);
  assert.match(source, /variant === 'detail' && !showGlints \? 0 : preset\.glintCount/);
  assert.match(source, /tiltX: t\.x, tiltY: t\.y/);
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  assert.equal((detail.match(/showGlints/g) ?? []).length, 2);
});

test('색·반사 합성은 사진과 같은 부모의 형제 뷰이며 각 층은 터치·접근성에서 제외된다', () => {
  const visual = source.slice(source.indexOf('function MaterialVisual'), source.indexOf('function AutonomousLayer'));
  assert.match(visual, /return <>/);
  assert.match(visual, /mixBlendMode: isGold \? 'normal' : isPrism \? 'overlay' : 'soft-light'/);
  assert.match(visual, /mixBlendMode: isGold \? 'normal' : 'screen'/);
  assert.equal((visual.match(/<View pointerEvents="none" accessible=\{false\} importantForAccessibility="no-hide-descendants"/g) ?? []).length, 3);
});

test('림은 사진 반사 좌표를 윤곽 공간으로 보정하고 별빛은 네이티브 SVG 행렬로 커졌다 작아진다', () => {
  assert.match(source, /id=\{rimLightId\}[\s\S]*?animatedProps=\{bandProps\}[\s\S]*?gradientTransform=\{`scale\(\$\{100 \/ size\}\)`\}/);
  assert.match(source, /<AnimatedGroup animatedProps=\{edgeProps\} scale=\{size \/ 100\} opacity=\{coreAlpha\}>/);
  assert.match(source, /matrix: \[zoom, 0, 0, zoom, x \* size, y \* size\]/);
});

test('골드 바탕과 반사띠는 유색 그라데이션을 쓰고 두 등급의 림은 지속 색·이동 빛을 일반 합성한다', () => {
  assert.match(source, /GOLD_WARM_STOPS\.map/);
  assert.match(source, /const bandStops = isGold \? GOLD_BAND_STOPS\.map/);
  assert.match(source, /fill=\{isGold \? `url\(#\$\{warmId\}\)`/);
  const rim = source.slice(source.indexOf('{vivid ? <View'));
  assert.match(rim, /mixBlendMode: 'normal'/);
  assert.match(rim, /mask=\{Platform\.OS === 'web' \? undefined : `url\(#\$\{rimMaskId\}\)`\}/);
  assert.match(rim, /: PRISM_FOIL_STOPS/);
  assert.match(rim, /stroke=\{`url\(#\$\{rimId\}\)`\} strokeWidth=\{4\.5\}/);
  assert.match(rim, /stroke=\{`url\(#\$\{rimLightId\}\)`\} strokeWidth=\{4\.5\}/);
  assert.match(source, /variant === 'card' \? \.8/);
  assert.match(source, /material === 'gold' \? \.057 : \.048/);
});
