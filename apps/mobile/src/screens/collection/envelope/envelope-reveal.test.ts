import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Source-contract check, same style as collectible-focus.test.ts: the tear transition's background/reduce-motion/
// dispose handling is covered behaviorally by reveal-lifecycle.test.ts against the real class; this only confirms
// the envelope actually drives it instead of a second, inline timer implementation.
const source = readFileSync(new URL('./envelope-reveal.tsx', import.meta.url), 'utf8');

test('the tear transition is driven by RevealLifecycle, not an inline reimplementation', () => {
  assert.match(source, /new RevealLifecycle\(/);
  assert.match(source, /lifecycle\?\.setForeground\(/);
  assert.match(source, /lifecycle\?\.setMotionAllowed\(/);
  assert.match(source, /lifecycle\?\.dispose\(\)/);
});

// Regression this guards: constructing RevealLifecycle at mount (like the single-collectible reveal does) would set
// its `stage` to 'opening' immediately, so backgrounding the idle, untapped envelope would auto-complete a tear
// nobody asked for. The instance must only exist once the person actually taps.
test('the lifecycle is created on tap, not at mount', () => {
  const body = source.slice(source.indexOf('export function EnvelopeReveal'));
  const openIndex = body.indexOf('function openEnvelope');
  assert.ok(openIndex > 0, 'openEnvelope를 찾을 수 없다');
  assert.match(body.slice(0, openIndex), /const \[lifecycle, setLifecycle\] = useState<RevealLifecycle>\(\);/);
  assert.match(body.slice(openIndex), /new RevealLifecycle\(/);
});

test('skip is always available, independent of the current stage', () => {
  assert.match(source, /<SkipButton onPress=\{onSkip\} \/>/);
});
