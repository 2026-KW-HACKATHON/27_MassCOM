import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ROUND_POLL_INTERVAL_MS, createRoundPoller, type PollTimers } from './round-polling';
import type { ArtRound, ArtRoundStatus } from './owner-art-api';

const id = '11111111-1111-4111-8111-111111111111';
const roundOf = (status: ArtRoundStatus): ArtRound => ({
  id, status, drafts: [], chosenIndex: null, final: null, failureCode: status === 'FAILED' ? 'AI_ART_TIMEOUT' : null, createdAt: '2026-09-29T10:00:00.000Z',
});

/** Timers the test moves by hand, so "every 3 seconds" is checked without waiting. */
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

function harness(statuses: (ArtRoundStatus | Error)[], extra: { isPermanentError?: (error: unknown) => boolean } = {}) {
  const clock = fakeTimers();
  const seen: ArtRound[] = [];
  const errors: unknown[] = [];
  let requests = 0;
  const poller = createRoundPoller({
    poll: async () => {
      const next = statuses[Math.min(requests, statuses.length - 1)]!;
      requests += 1;
      if (next instanceof Error) throw next;
      return roundOf(next);
    },
    onRound: (round) => seen.push(round),
    onError: (error) => errors.push(error),
    timers: clock.timers,
    ...extra,
  });
  return { clock, poller, seen, errors, requests: () => requests };
}

test('it asks every 3 seconds, not at once, while the round is drawing', async () => {
  assert.equal(ROUND_POLL_INTERVAL_MS, 3000);
  const { clock, poller, seen, requests } = harness(['DRAFTING']);
  poller.start();
  assert.equal(requests(), 0);
  clock.advance(2999);
  await settle();
  assert.equal(requests(), 0);
  clock.advance(1);
  await settle();
  assert.equal(requests(), 1);
  assert.equal(seen.length, 1);
  clock.advance(3000);
  await settle();
  clock.advance(3000);
  await settle();
  assert.equal(requests(), 3);
  assert.equal(poller.isRunning(), true);
});

test('it stops by itself when the round is ready for the owner, and asks no more', async () => {
  const { clock, poller, seen, requests } = harness(['DRAFTING', 'DRAFTING', 'DRAFTS_READY']);
  poller.start();
  for (let i = 0; i < 3; i += 1) { clock.advance(3000); await settle(); }
  assert.deepEqual(seen.map((round) => round.status), ['DRAFTING', 'DRAFTING', 'DRAFTS_READY']);
  assert.equal(poller.isRunning(), false);
  assert.equal(clock.pending, 0);
  clock.advance(30_000);
  await settle();
  assert.equal(requests(), 3);
});

test('it also stops on a failed round and on a finished final', async () => {
  for (const last of ['FAILED', 'FINAL_READY', 'APPLIED'] as const) {
    const { clock, poller, requests } = harness(['FINALIZING', last]);
    poller.start();
    for (let i = 0; i < 4; i += 1) { clock.advance(3000); await settle(); }
    assert.equal(requests(), 2, last);
    assert.equal(poller.isRunning(), false, last);
  }
});

test('stopping (leaving the screen) cancels the timer so nothing more is asked', async () => {
  const { clock, poller, requests } = harness(['DRAFTING']);
  poller.start();
  clock.advance(3000);
  await settle();
  assert.equal(requests(), 1);
  poller.stop();
  assert.equal(poller.isRunning(), false);
  assert.equal(clock.pending, 0);
  clock.advance(60_000);
  await settle();
  assert.equal(requests(), 1);
});

test('an answer that arrives after stop is ignored and schedules nothing', async () => {
  const clock = fakeTimers();
  const slow = deferred<ArtRound>();
  const seen: ArtRound[] = [];
  const poller = createRoundPoller({ poll: () => slow.promise, onRound: (round) => seen.push(round), onError: () => undefined, timers: clock.timers });
  poller.start();
  clock.advance(3000);
  await settle();
  poller.stop();
  slow.resolve(roundOf('DRAFTING'));
  await settle();
  assert.equal(seen.length, 0);
  assert.equal(clock.pending, 0);
});

test('an error that arrives after stop is ignored too', async () => {
  const clock = fakeTimers();
  const slow = deferred<ArtRound>();
  const errors: unknown[] = [];
  const poller = createRoundPoller({ poll: () => slow.promise, onRound: () => undefined, onError: (error) => errors.push(error), timers: clock.timers });
  poller.start();
  clock.advance(3000);
  await settle();
  poller.stop();
  slow.reject(new Error('late'));
  await settle();
  assert.equal(errors.length, 0);
  assert.equal(clock.pending, 0);
});

test('a slow answer from before a stop and restart does not count as the new run', async () => {
  const clock = fakeTimers();
  const first = deferred<ArtRound>();
  const seen: ArtRound[] = [];
  let calls = 0;
  const poller = createRoundPoller({
    poll: () => { calls += 1; return calls === 1 ? first.promise : Promise.resolve(roundOf('FINALIZING')); },
    onRound: (round) => seen.push(round), onError: () => undefined, timers: clock.timers,
  });
  poller.start();
  clock.advance(3000);
  await settle();
  poller.stop();
  poller.start();
  first.resolve(roundOf('DRAFTING'));
  await settle();
  assert.equal(seen.length, 0);
  clock.advance(3000);
  await settle();
  assert.deepEqual(seen.map((round) => round.status), ['FINALIZING']);
});

test('one request at a time: the next is scheduled only after the last one answered', async () => {
  const clock = fakeTimers();
  const answers: ReturnType<typeof deferred<ArtRound>>[] = [];
  const poller = createRoundPoller({
    poll: () => { const answer = deferred<ArtRound>(); answers.push(answer); return answer.promise; },
    onRound: () => undefined, onError: () => undefined, timers: clock.timers,
  });
  poller.start();
  clock.advance(3000);
  await settle();
  clock.advance(30_000);
  await settle();
  assert.equal(answers.length, 1);
  answers[0]!.resolve(roundOf('DRAFTING'));
  await settle();
  clock.advance(3000);
  await settle();
  assert.equal(answers.length, 2);
});

test('starting twice does not double the polling', async () => {
  const { clock, poller, requests } = harness(['DRAFTING']);
  poller.start();
  poller.start();
  clock.advance(3000);
  await settle();
  assert.equal(requests(), 1);
  assert.equal(clock.pending, 1);
});

test('a network or server error is reported and polling keeps trying', async () => {
  const boom = new Error('network');
  const { clock, poller, seen, errors, requests } = harness([boom, boom, 'DRAFTING', 'DRAFTS_READY']);
  poller.start();
  for (let i = 0; i < 4; i += 1) { clock.advance(3000); await settle(); }
  assert.equal(errors.length, 2);
  assert.deepEqual(seen.map((round) => round.status), ['DRAFTING', 'DRAFTS_READY']);
  assert.equal(requests(), 4);
  assert.equal(poller.isRunning(), false);
});

test('an error that asking again cannot fix stops polling', async () => {
  const denied = new Error('403');
  const { clock, poller, errors, requests } = harness([denied, 'DRAFTING'], { isPermanentError: (error) => error === denied });
  poller.start();
  for (let i = 0; i < 3; i += 1) { clock.advance(3000); await settle(); }
  assert.deepEqual(errors, [denied]);
  assert.equal(requests(), 1);
  assert.equal(poller.isRunning(), false);
  assert.equal(clock.pending, 0);
});

test('it can be started again after it stopped', async () => {
  const { clock, poller, requests } = harness(['DRAFTS_READY', 'DRAFTING']);
  poller.start();
  clock.advance(3000);
  await settle();
  assert.equal(poller.isRunning(), false);
  poller.start();
  clock.advance(3000);
  await settle();
  assert.equal(requests(), 2);
  assert.equal(poller.isRunning(), true);
});

test('a custom interval is honoured', async () => {
  const clock = fakeTimers();
  let requests = 0;
  const poller = createRoundPoller({
    poll: async () => { requests += 1; return roundOf('DRAFTING'); }, onRound: () => undefined, onError: () => undefined,
    timers: clock.timers, intervalMs: 500,
  });
  poller.start();
  clock.advance(499);
  await settle();
  assert.equal(requests, 0);
  clock.advance(1);
  await settle();
  assert.equal(requests, 1);
});
