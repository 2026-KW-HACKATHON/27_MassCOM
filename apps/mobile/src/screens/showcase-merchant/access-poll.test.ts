import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ACCESS_POLL_INTERVAL_MS, createAccessPoller, needsPermissionRecheck, type PollTimers } from './access-poll';

type Answer = { status: 'PENDING' | 'APPROVED' | 'REJECTED' };

/** 손으로 시간을 넘기는 가짜 타이머(round-polling.test.ts와 같은 모양). */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: PollTimers = {
    setTimeout(callback, ms) { const handle = next++; pending.set(handle, { at: now + ms, callback }); return handle; },
    clearTimeout(handle) { pending.delete(handle as number); },
  };
  return {
    timers,
    get pending() { return pending.size; },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) { pending.delete(handle); timer.callback(); }
      }
    },
  };
}

const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness(answers: (Answer['status'] | Error)[]) {
  const clock = fakeTimers();
  const seen: Answer[] = [];
  const errors: unknown[] = [];
  let requests = 0;
  const poller = createAccessPoller<Answer>({
    poll: async () => {
      const next = answers[Math.min(requests, answers.length - 1)]!;
      requests += 1;
      if (next instanceof Error) throw next;
      return { status: next };
    },
    onResult: (result) => seen.push(result),
    onError: (error) => errors.push(error),
    shouldContinue: (result) => result.status === 'PENDING',
    timers: clock.timers,
  });
  return { clock, poller, seen, errors, requests: () => requests };
}

test('it asks every 5 seconds, not at once, while the request is pending', async () => {
  assert.equal(ACCESS_POLL_INTERVAL_MS, 5000);
  const { clock, poller, requests } = harness(['PENDING']);
  poller.start();
  assert.equal(requests(), 0);
  clock.advance(4999);
  await settle();
  assert.equal(requests(), 0);
  clock.advance(1);
  await settle();
  assert.equal(requests(), 1);
  clock.advance(5000);
  await settle();
  assert.equal(requests(), 2);
  assert.equal(poller.isRunning(), true);
});

test('it stops by itself once the request is approved, and asks no more', async () => {
  const { clock, poller, seen, requests } = harness(['PENDING', 'PENDING', 'APPROVED']);
  poller.start();
  for (let i = 0; i < 4; i += 1) { clock.advance(5000); await settle(); }
  assert.deepEqual(seen.map((result) => result.status), ['PENDING', 'PENDING', 'APPROVED']);
  assert.equal(poller.isRunning(), false);
  assert.equal(clock.pending, 0);
  assert.equal(requests(), 3);
});

test('it also stops once the request is rejected', async () => {
  const { clock, poller, requests } = harness(['PENDING', 'REJECTED']);
  poller.start();
  for (let i = 0; i < 3; i += 1) { clock.advance(5000); await settle(); }
  assert.equal(requests(), 2);
  assert.equal(poller.isRunning(), false);
});

test('a network error is reported and polling keeps trying', async () => {
  const boom = new Error('network');
  const { clock, poller, seen, errors } = harness([boom, 'PENDING', 'APPROVED']);
  poller.start();
  for (let i = 0; i < 3; i += 1) { clock.advance(5000); await settle(); }
  assert.equal(errors.length, 1);
  assert.deepEqual(seen.map((result) => result.status), ['PENDING', 'APPROVED']);
  assert.equal(poller.isRunning(), false);
});

test('stopping (leaving the screen, or the app going to background) cancels the timer so nothing more is asked', async () => {
  const { clock, poller, requests } = harness(['PENDING']);
  poller.start();
  clock.advance(5000);
  await settle();
  assert.equal(requests(), 1);
  poller.stop();
  assert.equal(poller.isRunning(), false);
  assert.equal(clock.pending, 0);
  clock.advance(60_000);
  await settle();
  assert.equal(requests(), 1);
});

test('a reply slower than the interval overlaps nothing: the next ask waits for it to answer first', async () => {
  const clock = fakeTimers();
  const answers: ReturnType<typeof deferred<Answer>>[] = [];
  const poller = createAccessPoller<Answer>({
    poll: () => { const answer = deferred<Answer>(); answers.push(answer); return answer.promise; },
    onResult: () => undefined,
    shouldContinue: (result) => result.status === 'PENDING',
    timers: clock.timers,
  });
  poller.start();
  clock.advance(5000);
  await settle();
  // The interval would have fired twice more by now under a naive setInterval; only one request is ever out.
  clock.advance(30_000);
  await settle();
  assert.equal(answers.length, 1);
  answers[0]!.resolve({ status: 'PENDING' });
  await settle();
  clock.advance(5000);
  await settle();
  assert.equal(answers.length, 2);
});

test('a stale reply from before a stop (and a fresh request started after) is dropped, never overwriting the newer state', async () => {
  const clock = fakeTimers();
  const first = deferred<Answer>();
  const seen: Answer[] = [];
  const poller = createAccessPoller<Answer>({
    poll: () => first.promise,
    onResult: (result) => seen.push(result),
    shouldContinue: (result) => result.status === 'PENDING',
    timers: clock.timers,
  });
  poller.start();
  clock.advance(5000);
  await settle();
  // The screen stops polling (status moved on, the screen lost focus, or a fresh request was made) while the old GET is still out.
  poller.stop();
  // The old GET finally answers with stale data (e.g. REJECTED, read before the owner re-requested access).
  first.resolve({ status: 'REJECTED' });
  await settle();
  assert.deepEqual(seen, []);
  assert.equal(clock.pending, 0);
});

test('starting twice does not double the polling', async () => {
  const { clock, poller, requests } = harness(['PENDING']);
  poller.start();
  poller.start();
  clock.advance(5000);
  await settle();
  assert.equal(requests(), 1);
  assert.equal(clock.pending, 1);
});

test('needsPermissionRecheck asks for a recheck only when an approval has not been reflected on screen yet', () => {
  assert.equal(needsPermissionRecheck('APPROVED', 'denied'), true);
  assert.equal(needsPermissionRecheck('APPROVED', 'loading'), true);
  assert.equal(needsPermissionRecheck('APPROVED', 'allowed'), false);
  assert.equal(needsPermissionRecheck('PENDING', 'denied'), false);
  assert.equal(needsPermissionRecheck('REJECTED', 'denied'), false);
  assert.equal(needsPermissionRecheck(undefined, 'denied'), false);
});
