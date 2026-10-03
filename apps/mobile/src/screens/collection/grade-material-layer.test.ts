import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./grade-material-layer.tsx', import.meta.url), 'utf8');

test('등급 조명은 사진 알파 또는 공통 윤곽 안에만 그린다', () => {
  assert.match(source, /<Mask id=\{maskId\} maskType="alpha">/);
  assert.match(source, /faceUri \? <SvgImage/);
  assert.match(source, /<CollectibleFaceOutline shape=\{shape\} fill="white" \/>/);
  assert.match(source, /<G mask=\{`url\(#\$\{maskId\}\)`\}>/);
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
