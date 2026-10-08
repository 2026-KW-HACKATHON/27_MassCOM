import assert from 'node:assert/strict';
import test from 'node:test';

import { abortableSleep, runWorkerLoop } from './worker-loop.js';

const errorBackoff = { initialMs: 1_000, maxMs: 8_000 };

/** 정해진 결과를 차례로 돌려주고 다 쓰면 중지 신호를 보낸다. */
function scripted(steps: Array<boolean | Error>, stop: AbortController) {
  const calls = { runOnce: 0 };
  return {
    calls,
    runOnce: async () => {
      calls.runOnce += 1;
      const step = steps.shift();
      if (steps.length === 0) queueMicrotask(() => stop.abort());
      if (step === undefined) return false;
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

test('작업이 있으면 유휴 대기 없이 이어서 처리하고, 없을 때만 유휴 시간만큼 쉰다', async () => {
  const stop = new AbortController();
  const script = scripted([true, true, false, false], stop);
  const sleeps: number[] = [];
  await runWorkerLoop({
    runOnce: script.runOnce,
    signal: stop.signal,
    sleep: async (ms) => { sleeps.push(ms); },
    idleMs: 3_000,
    jitterMs: 1_000,
    busyPauseMs: 200,
    errorBackoff,
    random: () => 0.5,
  });
  // 처리 2건 사이에는 짧은 쉼만, 빈 반복에는 3000 + 지터 500. 마지막 반복은 중지 신호로 쉬지 않는다.
  assert.deepEqual(sleeps, [200, 200, 3_500]);
  assert.equal(script.calls.runOnce, 4);
});

test('한 번에 한 건만 처리한다(처리 중에 다음 처리를 시작하지 않는다)', async () => {
  const stop = new AbortController();
  let running = 0;
  let maxRunning = 0;
  let remaining = 5;
  await runWorkerLoop({
    runOnce: async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      remaining -= 1;
      if (remaining === 0) stop.abort();
      return true;
    },
    signal: stop.signal,
    sleep: async () => {},
    idleMs: 1_000,
    errorBackoff,
  });
  assert.equal(maxRunning, 1);
  assert.equal(remaining, 0);
});

test('예외가 나면 간격을 두 배씩 늘려(상한까지) 다시 시도하고, 성공하면 처음 간격으로 돌아간다', async () => {
  const stop = new AbortController();
  const failures = Array.from({ length: 5 }, () => new Error('boom'));
  const script = scripted([...failures, false, new Error('again'), false], stop);
  const sleeps: number[] = [];
  const errors: number[] = [];
  await runWorkerLoop({
    runOnce: script.runOnce,
    signal: stop.signal,
    sleep: async (ms) => { sleeps.push(ms); },
    idleMs: 3_000,
    errorBackoff,
    onError: (_error, nextDelayMs) => errors.push(nextDelayMs),
  });
  assert.deepEqual(errors, [1_000, 2_000, 4_000, 8_000, 8_000, 1_000]);
  // 오류 5번 → 성공(유휴 3000) → 오류 1번 → 성공(마지막은 중지 신호로 쉬지 않음)
  assert.deepEqual(sleeps, [1_000, 2_000, 4_000, 8_000, 8_000, 3_000, 1_000]);
});

test('상태 신호는 성공한 확인(처리했든 비었든)에서만 보내고 오류에서는 보내지 않는다', async () => {
  const stop = new AbortController();
  const script = scripted([true, new Error('db down'), false], stop);
  const healthy: boolean[] = [];
  await runWorkerLoop({
    runOnce: script.runOnce,
    signal: stop.signal,
    sleep: async () => {},
    idleMs: 1_000,
    errorBackoff,
    onHealthy: (processed) => healthy.push(processed),
  });
  assert.deepEqual(healthy, [true, false]);
});

test('중지 신호가 오면 처리 중인 한 건을 끝낸 뒤 더 시작하지 않고 끝난다', async () => {
  const stop = new AbortController();
  let finished = false;
  let calls = 0;
  await runWorkerLoop({
    runOnce: async () => {
      calls += 1;
      stop.abort(); // 처리 도중 SIGTERM
      await new Promise((resolve) => setImmediate(resolve));
      finished = true;
      return true;
    },
    signal: stop.signal,
    sleep: async () => { assert.fail('중지 뒤에는 쉬지 않는다'); },
    idleMs: 1_000,
    busyPauseMs: 200,
    errorBackoff,
  });
  assert.equal(finished, true);
  assert.equal(calls, 1);
});

test('이미 중지된 신호로는 한 건도 시작하지 않는다', async () => {
  const stop = new AbortController();
  stop.abort();
  let calls = 0;
  await runWorkerLoop({
    runOnce: async () => { calls += 1; return true; },
    signal: stop.signal,
    sleep: async () => {},
    idleMs: 1_000,
    errorBackoff,
  });
  assert.equal(calls, 0);
});

test('abortableSleep은 시간이 지나면 끝나고, 신호가 오면 바로 깨어난다', async () => {
  const idle = new AbortController();
  const started = Date.now();
  await abortableSleep(30, idle.signal);
  assert.ok(Date.now() - started >= 20);

  const stop = new AbortController();
  const waiting = abortableSleep(60_000, stop.signal);
  setTimeout(() => stop.abort(), 10);
  const before = Date.now();
  await waiting;
  assert.ok(Date.now() - before < 5_000, '신호가 와도 오래 기다렸다');

  const aborted = new AbortController();
  aborted.abort();
  const startedAborted = Date.now();
  await abortableSleep(60_000, aborted.signal);
  assert.ok(Date.now() - startedAborted < 1_000);
});
