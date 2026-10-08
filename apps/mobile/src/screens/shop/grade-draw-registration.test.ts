import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./grade-draw-machine.tsx', import.meta.url), 'utf8');
const resultEffect = source.slice(source.indexOf('  useEffect(() => {\n    if (!result) return;'), source.indexOf('  useEffect(() => () =>'));

function settleExistingResult(initialPhase: string): string {
  let phase = initialPhase;
  let effect: () => (() => void) | void = () => undefined;
  const scheduled: (() => void)[] = [];
  const result = { drawId: 'draw-1' };
  runInNewContext(resultEffect, {
    result,
    seen: { current: result },
    motionAllowed: false,
    crank: {}, jiggle: {}, openingScale: {},
    useEffect: (callback: typeof effect) => { effect = callback; },
    setTimeout: (callback: () => void) => { scheduled.push(callback); return scheduled.length; },
    clearTimeout: () => undefined,
    setPhase: (next: string | ((current: string) => string)) => { phase = typeof next === 'function' ? next(phase) : next; },
  });
  effect();
  for (const callback of scheduled) callback();
  return phase;
}

test('motion preference changes preserve open grade-draw registration', () => {
  assert.equal(settleExistingResult('album-registration'), 'album-registration');
});

test('an existing grade-draw result still settles an interrupted opening', () => {
  assert.equal(settleExistingResult('opening'), 'result');
});
