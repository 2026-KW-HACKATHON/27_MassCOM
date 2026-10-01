import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDecideController } from './decide-controller';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function handlers() {
  const calls: string[] = [];
  return {
    calls,
    onBegin: (id: string) => calls.push(`begin ${id}`),
    onSuccess: () => calls.push('success'),
    onError: (error: unknown) => calls.push(`error ${(error as Error).message}`),
    onSettled: () => calls.push('settled'),
  };
}

test('row A busy blocks row B even though B was never the row that set busyId (the stale-closure bug, #294 review finding 4)', async () => {
  const first = deferred<void>();
  const controller = createDecideController(() => first.promise);
  const a = handlers();
  const b = handlers();
  const runningA = controller.decide({ id: 'a' }, 'approve', a);
  // Row B is pressed while A is still in flight: a second decision in the same gate must be refused outright, never queued and
  // never silently accepted only to do nothing once A finishes.
  await controller.decide({ id: 'b' }, 'approve', b);
  assert.deepEqual(a.calls, ['begin a']);
  assert.deepEqual(b.calls, []);
  first.resolve();
  await runningA;
  assert.deepEqual(a.calls, ['begin a', 'success', 'settled']);
  // The gate is free now: a fresh confirm on B (the user tapping again after the buttons re-enable) goes through normally,
  // proving B was refused, not silently swallowed forever.
  const second = deferred<void>();
  const controller2 = createDecideController(() => second.promise, controller.gate);
  void controller2.decide({ id: 'b' }, 'approve', b);
  second.resolve();
  await second.promise;
  await Promise.resolve();
  assert.deepEqual(b.calls, ['begin b', 'success', 'settled']);
});

test('a failed decision reports the error and still frees the gate for the next row', async () => {
  const failure = new Error('이미 처리된 요청');
  const controller = createDecideController(() => Promise.reject(failure));
  const a = handlers();
  await controller.decide({ id: 'a' }, 'reject', a);
  // `onSettled` (clearing the busy row) runs as the failed decide() unwinds, before `onError` reports the message; either order
  // is fine for the screen, both land before the next render.
  assert.deepEqual(a.calls, ['begin a', 'settled', 'error 이미 처리된 요청']);
  // The gate freed itself after the failure: a fresh decision (a different request that now succeeds) goes through.
  const succeeding = createDecideController(() => Promise.resolve(), controller.gate);
  const b = handlers();
  await succeeding.decide({ id: 'b' }, 'approve', b);
  assert.deepEqual(b.calls, ['begin b', 'success', 'settled']);
});

test('every decision reads whether the gate is busy at the moment it is confirmed, not a snapshot from an earlier render', async () => {
  const controller = createDecideController(() => Promise.resolve());
  const calls: string[] = [];
  // Two decisions "confirmed" back to back synchronously (double tap, or two different rows) share one live gate: only the
  // first is accepted no matter which object captured which closure first.
  const p1 = controller.decide({ id: 'a' }, 'approve', { onBegin: () => calls.push('begin-a'), onSuccess: () => calls.push('ok-a'), onError: () => {}, onSettled: () => {} });
  const p2 = controller.decide({ id: 'b' }, 'approve', { onBegin: () => calls.push('begin-b'), onSuccess: () => calls.push('ok-b'), onError: () => {}, onSettled: () => {} });
  await Promise.all([p1, p2]);
  assert.deepEqual(calls, ['begin-a', 'ok-a']);
});
