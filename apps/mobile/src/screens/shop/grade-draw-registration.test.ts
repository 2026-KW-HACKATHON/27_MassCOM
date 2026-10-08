import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./grade-draw-machine.tsx', import.meta.url), 'utf8');
const resultEffect = source.slice(source.indexOf('  useEffect(() => {\n    if (!result) return;'), source.indexOf('  const start = async'));

function runResultEffect({ initialPhase, seenResult, replayed = false, motionAllowed = true }: {
  initialPhase: string;
  seenResult?: 'same' | object;
  replayed?: boolean;
  motionAllowed?: boolean;
}): { phase: () => string; run: () => void; cleanup: () => void; flush: () => void } {
  let phase = initialPhase;
  let effect: () => (() => void) | void = () => undefined;
  const scheduled = new Map<number, () => void>();
  let nextTimer = 1;
  const result = { drawId: 'draw-1', replayed };
  const seen = { current: seenResult === 'same' ? result : seenResult };
  runInNewContext(resultEffect, {
    result,
    seen,
    motionAllowed,
    drawInFlight: { current: false },
    drawHaptic: () => Promise.resolve(),
    useEffect: (callback: typeof effect) => { effect = callback; },
    setTimeout: (callback: () => void) => {
      const id = nextTimer++;
      scheduled.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => { scheduled.delete(id); },
    setPhase: (next: string | ((current: string) => string)) => { phase = typeof next === 'function' ? next(phase) : next; },
  });
  let cleanup: (() => void) | void;
  return {
    phase: () => phase,
    run: () => { cleanup = effect(); },
    cleanup: () => { cleanup?.(); },
    flush: () => {
      const callbacks = [...scheduled.values()];
      scheduled.clear();
      for (const callback of callbacks) callback();
    },
  };
}

function settleExistingResult(initialPhase: string, motionAllowed = true): string {
  const effect = runResultEffect({ initialPhase, seenResult: 'same', motionAllowed });
  effect.run();
  effect.flush();
  return effect.phase();
}

test('motion preference changes preserve open grade-draw registration', () => {
  assert.equal(settleExistingResult('album-registration'), 'album-registration');
});

test('an existing grade-draw result keeps opening until the stamp video completes', () => {
  assert.equal(settleExistingResult('opening'), 'opening');
});

test('strict-mode cleanup before the first grade opening timer does not skip the stamp video', () => {
  const first = runResultEffect({ initialPhase: 'pending' });
  first.run();
  first.cleanup();
  first.flush();
  assert.equal(first.phase(), 'pending');

  const rerun = runResultEffect({ initialPhase: first.phase(), seenResult: 'same' });
  rerun.run();
  rerun.flush();
  assert.equal(rerun.phase(), 'opening');
});

test('replayed or reduced-motion same grade result may skip directly to result', () => {
  assert.equal(settleExistingResult('pending', false), 'result');
  const replayed = runResultEffect({ initialPhase: 'pending', seenResult: 'same', replayed: true });
  replayed.run();
  replayed.flush();
  assert.equal(replayed.phase(), 'result');
});
