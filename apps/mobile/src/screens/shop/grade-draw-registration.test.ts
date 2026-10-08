import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./grade-draw-machine.tsx', import.meta.url), 'utf8');
const resultEffect = source.slice(source.indexOf('  useEffect(() => {\n    if (!result) return;'), source.indexOf('  const start = async'));

function runResultEffect({ initialPhase, seenResult, replayed = false, motionAllowed = true, openingFinished = false }: {
  initialPhase: string;
  seenResult?: 'same' | object;
  replayed?: boolean;
  motionAllowed?: boolean;
  openingFinished?: boolean;
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
    openingComplete: { current: openingFinished },
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

test('first tap draws once; second reveal tap waits for the same result without spending again', async () => {
  const startSource = source.slice(source.indexOf('  const start = async () => {'), source.indexOf('  const displayedBalance ='));
  const finishSource = source.slice(source.indexOf('  const finishOpening = () => {'), source.indexOf('  return <FullScreenModal'));
  const make = new Function('onDraw', 'onClose', 'setPhase', 'setCloseNotice', 'setOpeningFinished', 'openingComplete',
    'drawInFlight', 'pool', 'balance', 'busy', 'phase', 'result', 'seen', 'playUiSound', 'drawHaptic',
    `${startSource}\n${finishSource}\nreturn { start, finishOpening };`) as (...args: unknown[]) =>
    { start: () => Promise<void>; finishOpening: () => void };
  let resolveDraw!: (success: boolean) => void;
  let calls = 0, finished = 0, phase = 'detail';
  const openingComplete = { current: false }, drawInFlight = { current: false };
  const draw = new Promise<boolean>(resolve => { resolveDraw = resolve; });
  const common = [() => { calls++; return draw; }, () => undefined, (next: string) => { phase = next; },
    () => undefined, (value: boolean) => { if (value) finished++; }, openingComplete, drawInFlight, { total: 1, price: 100 }, 200, false];
  const first = make(...common, 'opening', undefined, { current: undefined }, () => undefined, () => undefined);
  const pending = first.start();
  await first.start();
  assert.equal(calls, 1);
  assert.equal(phase, 'opening');
  first.finishOpening(); first.finishOpening();
  assert.equal(openingComplete.current, true);
  assert.equal(finished, 1);
  assert.equal(phase, 'opening', 'the video ends but the server result is still pending');
  resolveDraw(true); await pending;
  const effect = runResultEffect({ initialPhase: phase, openingFinished: true });
  effect.run(); effect.flush();
  assert.equal(effect.phase(), 'result');
  assert.equal(calls, 1);
});

test('natural video end and skip share one completion latch after the draw result arrives', () => {
  const finishSource = source.slice(source.indexOf('  const finishOpening = () => {'), source.indexOf('  return <FullScreenModal'));
  const make = new Function('phase', 'openingComplete', 'setOpeningFinished', 'result', 'seen', 'setPhase',
    'playUiSound', 'drawHaptic', `${finishSource}\nreturn finishOpening;`) as (...args: unknown[]) => () => void;
  const result = { drawId: 'draw-1' };
  const openingComplete = { current: false };
  let results = 0, sounds = 0, haptics = 0;
  const finish = make('opening', openingComplete, () => undefined, result, { current: result },
    (next: string) => { if (next === 'result') results++; }, () => { sounds++; }, () => { haptics++; });
  finish(); finish();
  assert.deepEqual([results, sounds, haptics], [1, 1, 1]);
});
