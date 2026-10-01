import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract check in the same style as collectible-focus.test.ts, for what a renderer would be needed to see
// directly. The envelope sequencing itself (idle/tearing/cards/end, NEW detection, milestone, skip) is covered
// behaviorally by envelope/envelope-state.test.ts and reveal-lifecycle.test.ts; this only confirms the screen wires
// into those instead of reimplementing them.
const source = readFileSync(new URL('./collectible-reveal.tsx', import.meta.url), 'utf8');

test('skip is offered in every stage, including while loading and on failure', () => {
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind=\{failure\.removed/, '실패 상태에도 건너뛰기가 있어야 한다');
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>\s*\n\s*<StateScene kind="loading"/, '로딩 상태에도 건너뛰기가 있어야 한다');
});

test('a partial load failure still shows the cards that did load; only a total failure shows the failure screen', () => {
  assert.match(source, /loaded\.length === 0 && hadError/);
});

test('the reveal screen computes NEW/milestone/series through envelope-state.ts, not an inline reimplementation', () => {
  assert.match(source, /newEntitlementIds\(/);
  assert.match(source, /milestoneForBatch\(/);
  assert.match(source, /seriesForBatch\(/);
});

test('the envelope sequence and its tear-stage lifecycle live in envelope/envelope-reveal.tsx, not here', () => {
  assert.match(source, /import \{ EnvelopeReveal, type EnvelopeCardData \} from '\.\/envelope\/envelope-reveal';/);
  assert.doesNotMatch(source, /new RevealLifecycle\(/, 'RevealLifecycle은 envelope-reveal.tsx 쪽 책임이다');
});
