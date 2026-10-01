import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract check in the same style as collectible-focus.test.ts, for what a renderer would be needed to see
// directly (skip button presence across JSX branches). The lifecycle/audio timing this file used to assert by
// regex — backgrounding mid-animation, reduce-motion mid-animation, a stale mute/play race — is now covered
// behaviorally by reveal-lifecycle.test.ts, driven against the real RevealLifecycle class with mock timers and
// deferred promises; only a light check below confirms this component actually uses that class.
const source = readFileSync(new URL('./collectible-reveal.tsx', import.meta.url), 'utf8');

test('skip is offered in every stage, including while loading and on failure', () => {
  const beforeRevealBody = source.slice(0, source.indexOf('function RevealBody'));
  assert.match(beforeRevealBody, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind=\{failure\.removed/, '실패 상태에도 건너뛰기가 있어야 한다');
  assert.match(beforeRevealBody, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind="loading"/, '로딩 상태에도 건너뛰기가 있어야 한다');
});

test('the reveal screen drives its opening/audio lifecycle through RevealLifecycle, not an inline reimplementation', () => {
  assert.match(source, /new RevealLifecycle\(/);
  assert.match(source, /lifecycle\.play\(/);
  assert.match(source, /lifecycle\.setMuted\(/);
  assert.match(source, /lifecycle\.setForeground\(/);
  assert.match(source, /lifecycle\.setMotionAllowed\(/);
});
