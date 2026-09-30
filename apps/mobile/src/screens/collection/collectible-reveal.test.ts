import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract checks in the same style as collectible-focus.test.ts: the timing this file guards against
// (backgrounding mid-animation, reduce-motion toggled mid-animation, a stale mute/play race) needs real React
// effect/AppState timing to reproduce, which this repo's plain node:test style does not simulate.
const source = readFileSync(new URL('./collectible-reveal.tsx', import.meta.url), 'utf8');

test('skip is offered in every stage, including while loading and on failure', () => {
  const beforeRevealBody = source.slice(0, source.indexOf('function RevealBody'));
  assert.match(beforeRevealBody, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind=\{failure\.removed/, '실패 상태에도 건너뛰기가 있어야 한다');
  assert.match(beforeRevealBody, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind="loading"/, '로딩 상태에도 건너뛰기가 있어야 한다');
});

test('leaving the foreground cancels the opening animation/timer and jumps to the static end state', () => {
  const revealBody = source.slice(source.indexOf('function RevealBody'), source.indexOf('function Control'));
  assert.match(revealBody, /const moving = motionAllowed && foreground;/);
  assert.match(revealBody, /if \(state !== 'active'\) pause\(\);/, '백그라운드로 가면 재생을 멈춰야 한다');
  assert.match(revealBody, /if \(!moving\) \{[\s\S]*?reveal\.set\(1\); setStage\('revealed'\); \}, 0\);/, '동작 줄이기·백그라운드 전환 모두 열림 단계를 끝내고 결과 화면으로 넘어가야 한다');
});

test('muting pauses immediately and invalidates an in-flight play request via a generation counter', () => {
  const revealBody = source.slice(source.indexOf('function RevealBody'), source.indexOf('function Control'));
  assert.match(revealBody, /const onMutedChange = \(value: boolean\) => \{\s*setMuted\(value\);\s*if \(value\) pause\(\);/, '소리 끄기는 즉시 정지해야 한다');
  assert.match(revealBody, /const action = \+\+audioAction\.current;[\s\S]*?if \(action === audioAction\.current\) player\.play\(\);/, '대기 중 세대가 바뀌면 뒤늦게 재생하지 않아야 한다');
});
