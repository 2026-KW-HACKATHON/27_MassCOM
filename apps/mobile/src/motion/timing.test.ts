import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { motion, STAGGER_LIMIT, stampTilt, staggerDelay } from './timing';

test('stagger delay grows by 50ms and stops growing after the eighth item', () => {
  assert.equal(staggerDelay(0), 0);
  assert.equal(staggerDelay(1), 50);
  assert.equal(staggerDelay(7), 350);
  assert.equal(staggerDelay(8), 350);
  assert.equal(staggerDelay(120), 350);
  assert.equal(staggerDelay(-3), 0);
});

test('stagger delay ignores input that is not a finite number', () => {
  assert.equal(staggerDelay(Number.NaN), 0);
  assert.equal(staggerDelay(Number.POSITIVE_INFINITY), 0);
  assert.equal(staggerDelay(Number.NEGATIVE_INFINITY), 0);
});

test('only the first screenful staggers in', () => {
  assert.equal(STAGGER_LIMIT, 8);
  assert.equal(staggerDelay(STAGGER_LIMIT - 1), 350);
});

test('stamp tilt is stable per merchant and stays within 12 degrees', () => {
  const ids = ['merchant-a', 'merchant-b', 'showcase-c', '', 'x'.repeat(200)];
  for (const id of ids) {
    const tilt = stampTilt(id);
    assert.equal(stampTilt(id), tilt, 'deterministic');
    assert.ok(tilt >= -12 && tilt <= 12, `${id} → ${tilt}`);
  }
  assert.notEqual(stampTilt('merchant-a'), stampTilt('merchant-b'));
});

test('press feedback is subtle and the motion switch honours reduced motion', () => {
  assert.ok(motion.pressScale >= 0.94 && motion.pressScale < 1);
  const hook = readFileSync(fileURLToPath(new URL('./use-motion.ts', import.meta.url)), 'utf8');
  assert.match(hook, /useReducedMotion/);
  // Reanimated's value is read once at startup, so the live OS value is followed too; either one switches motion off.
  assert.match(hook, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(hook, /addEventListener\('reduceMotionChanged'/);
  assert.match(hook, /return !reanimatedReduced && !liveReduced/);
});
