import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('동행은 화면 포커스에서만 떠 있고 이탈 시 인사 동작까지 취소한다', () => {
  const companion = source('./companion.tsx');
  assert.match(companion, /useFocusEffect\(useCallback\(\(\) => \{\s*if \(motion && art\)/);
  assert.match(companion, /if \(celebrate\) scale\.set\(/);
  assert.match(companion, /return \(\) => \{ cancelAnimation\(lift\); cancelAnimation\(scale\); lift\.set\(0\); scale\.set\(1\); \}/);
});

test('마스코트는 화면 이탈 시 숨쉬기와 터치 회전을 취소한다', () => {
  const mascot = source('./mascot.tsx');
  assert.match(mascot, /useFocusEffect\(useCallback\(\(\) => \{\s*if \(enabled && breathe\)/);
  assert.match(mascot, /return \(\) => \{ cancelAnimation\(scale\); cancelAnimation\(rotate\); scale\.set\(1\); rotate\.set\(0\); \}/);
});

test('배경 구름과 우표 뽑기 영상의 반복도 화면 이탈 시 멈춘다', () => {
  const sky = source('./sky-art.tsx');
  const stampStage = source('../screens/shop/stamp-draw-stage.tsx');
  const stampMedia = source('../screens/shop/stamp-draw-media.ts');
  assert.match(sky, /useFocusEffect\(useCallback\(\(\) => \{\s*if \(enabled\)/);
  assert.match(sky, /return \(\) => \{ cancelAnimation\(x\); x\.set\(startX\); \}/);
  assert.match(stampStage, /useFocusEffect\(useCallback\(\(\) => \{[\s\S]*?setFocused\(true\)[\s\S]*?return \(\) => \{ setFocused\(false\); \};/);
  assert.match(stampStage, /AppState\.addEventListener\('change', \(state\) => setForeground\(state === 'active'\)\)/);
  assert.match(stampStage, /const active = focused && foreground/);
  assert.match(stampMedia, /playing: active && \(!opening \|\| !finishedOpening\)/);
});
