import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPromptGuard, createStepGate, readUnlessStale, runOwnerStep } from './owner-steps';

/** A promise the test settles by hand, so it decides the order in which answers arrive. */
function deferred<Value = void>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const noHandlers = { onBegin: () => {}, onError: () => {} };

test('a second owner step while one is running does nothing at all', async () => {
  const gate = createStepGate();
  const first = deferred();
  const calls: string[] = [];
  const running = runOwnerStep(gate, async () => { calls.push('first'); await first.promise; }, {
    onBegin: () => calls.push('begin first'), onError: () => calls.push('error first'),
  });
  // Double tap, or another button while the first request is out: refused, no work, no busy state, no epoch change.
  const stamp = gate.stamp();
  await runOwnerStep(gate, async () => { calls.push('second'); }, {
    onBegin: () => calls.push('begin second'), onError: () => calls.push('error second'),
  });
  assert.deepEqual(calls, ['begin first', 'first']);
  assert.equal(gate.isCurrent(stamp), true);
  first.resolve();
  await running;
  assert.deepEqual(calls, ['begin first', 'first']);
});

test('the gate opens again after a step succeeds or fails', async () => {
  const gate = createStepGate();
  const calls: string[] = [];
  await runOwnerStep(gate, async () => { calls.push('one'); }, noHandlers);
  await runOwnerStep(gate, async () => { calls.push('two'); throw new Error('boom'); }, {
    onBegin: () => calls.push('begin two'), onError: (error) => calls.push(`error ${(error as Error).message}`),
  });
  await runOwnerStep(gate, async () => { calls.push('three'); }, noHandlers);
  assert.deepEqual(calls, ['one', 'begin two', 'two', 'error boom', 'three']);
});

test('a failing step reports the error once and never rejects to the caller', async () => {
  const gate = createStepGate();
  const errors: unknown[] = [];
  const failure = new Error('server said no');
  await runOwnerStep(gate, async () => { throw failure; }, { onBegin: () => {}, onError: (error) => errors.push(error) });
  assert.deepEqual(errors, [failure]);
});

test('every accepted step advances the epoch and a refused one does not', async () => {
  const gate = createStepGate();
  const before = gate.stamp();
  assert.equal(gate.isCurrent(before), true);
  const held = deferred();
  const running = runOwnerStep(gate, () => held.promise, noHandlers);
  assert.equal(gate.isCurrent(before), false);
  const during = gate.stamp();
  await runOwnerStep(gate, async () => {}, noHandlers);
  assert.equal(gate.isCurrent(during), true);
  held.resolve();
  await running;
  // The stamp taken while the step ran is still current afterwards: only a new step makes it stale.
  assert.equal(gate.isCurrent(during), true);
  await runOwnerStep(gate, async () => {}, noHandlers);
  assert.equal(gate.isCurrent(during), false);
});

test('a reload that finishes with no owner step in between is applied', async () => {
  const gate = createStepGate();
  const applied: string[] = [];
  await readUnlessStale(gate, async () => 'fresh', { alive: () => true, onValue: (value) => applied.push(value) });
  assert.deepEqual(applied, ['fresh']);
});

test('a reload that began before an owner step cannot overwrite what the step just showed', async () => {
  const gate = createStepGate();
  const read = deferred<string>();
  const applied: string[] = [];
  const reload = readUnlessStale(gate, () => read.promise, { alive: () => true, onValue: (value) => applied.push(value) });
  // The owner taps while the reload is still out: the step shows its own answer first.
  await runOwnerStep(gate, async () => { applied.push('step result'); }, noHandlers);
  read.resolve('old picture from the server');
  await reload;
  assert.deepEqual(applied, ['step result']);
});

test('a reload that fails after an owner step began is dropped too, but one begun after it is heard', async () => {
  const gate = createStepGate();
  const failing = deferred<string>();
  const errors: string[] = [];
  const stale = readUnlessStale(gate, () => failing.promise, {
    alive: () => true, onValue: () => {}, onError: () => errors.push('stale failure'),
  });
  await runOwnerStep(gate, async () => {}, noHandlers);
  failing.reject(new Error('network'));
  await stale;
  assert.equal(errors.length, 0);
  await readUnlessStale(gate, async () => { throw new Error('network'); }, {
    alive: () => true, onValue: () => {}, onError: () => errors.push('fresh failure'),
  });
  assert.deepEqual(errors, ['fresh failure']);
});

test('nothing is applied to a screen that has gone away, for an answer or a failure', async () => {
  const gate = createStepGate();
  let alive = true;
  const seen: string[] = [];
  const slow = deferred<string>();
  const reload = readUnlessStale(gate, () => slow.promise, {
    alive: () => alive, onValue: (value) => seen.push(value), onError: () => seen.push('error'),
  });
  alive = false;
  slow.resolve('late');
  await reload;
  await readUnlessStale(gate, async () => { throw new Error('x'); }, {
    alive: () => alive, onValue: (value) => seen.push(value), onError: () => seen.push('error'),
  });
  assert.deepEqual(seen, []);
});

test('a failed reload without an error handler stays silent', async () => {
  const gate = createStepGate();
  await readUnlessStale(gate, async () => { throw new Error('quiet'); }, { alive: () => true, onValue: () => assert.fail('no value') });
});

test('while an alert is open a second tap opens nothing, and once it closes the next tap opens one', () => {
  const guard = createPromptGuard();
  const shown: string[] = [];
  const releases: (() => void)[] = [];
  assert.equal(guard.run((release) => { shown.push('first'); releases.push(release); }), true);
  assert.equal(guard.isOpen(), true);
  // The double tap, and a different confirm button while the first alert is still up.
  assert.equal(guard.run(() => shown.push('second')), false);
  assert.equal(guard.run(() => shown.push('third')), false);
  assert.deepEqual(shown, ['first']);
  releases[0]!();
  assert.equal(guard.isOpen(), false);
  assert.equal(guard.run((release) => { shown.push('fourth'); releases.push(release); }), true);
  assert.deepEqual(shown, ['first', 'fourth']);
  // Releasing twice (a button press and then the dismissal) is harmless.
  releases[1]!();
  releases[1]!();
  assert.equal(guard.isOpen(), false);
});

test('an alert that fails to open does not leave the guard shut', () => {
  const guard = createPromptGuard();
  assert.throws(() => guard.run(() => { throw new Error('cannot show'); }), /cannot show/);
  assert.equal(guard.isOpen(), false);
  assert.equal(guard.run(() => {}), true);
});
