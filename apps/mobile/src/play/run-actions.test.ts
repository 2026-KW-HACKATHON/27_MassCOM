import assert from 'node:assert/strict';
import test from 'node:test';
import { gameKinds, getGameBoard, minimumActionGapMs, minimumCompletedElapsedMs, scoreRun, scoreRunAtElapsed, type GameAction } from '../../../api/src/play-rules';
import { activeMomentFeedback, appendAction, completedRecordLabel, finalizeDeliveryActions, memoryRevealDelay, mobileMinimumActionGapMs, sessionProgress, shouldWaitForDeliverySample } from './run-actions';

test('progress width follows completed units on every board, including an early 12/12 result', () => {
  for (const kind of gameKinds) {
    const board = getGameBoard(kind, 17);
    const total = kind === 'stack' ? 6 : kind === 'memory' ? 6 : 12;
    const done = sessionProgress(board, total, kind === 'memory' ? 12 : 0, kind === 'delivery' ? 12 : 0);
    assert.equal(done.width, '100%');
    assert.match(done.label, new RegExp(`${total} / ${total}`));
  }
  const orders = getGameBoard('orders', 17);
  assert.deepEqual(sessionProgress(orders, 2, 0, 0), { label: '2 / 12개', width: `${2 / 12 * 100}%` });
});

test('transient game feedback disappears outside active play', () => {
  const stack = { text: '정확해요 +80점', good: true };
  const delivery = { text: '무사 통과 +65점', good: true };
  assert.deepEqual(activeMomentFeedback('playing', 'delivery', stack, delivery), delivery);
  assert.equal(activeMomentFeedback('result', 'delivery', stack, delivery), undefined);
  assert.equal(activeMomentFeedback('finishing', 'stack', stack, delivery), undefined);
});

test('an unfinished first attempt does not claim a zero-point best record', () => {
  assert.equal(completedRecordLabel(0, 0), '아직 기록이 없어요');
  assert.equal(completedRecordLabel(2, 340), '최고 340점');
});

test('mobile input gaps match the server contract for every game', () => {
  assert.deepEqual(mobileMinimumActionGapMs, minimumActionGapMs);
});

test('actions use elapsed time, drop fast taps and stop at the run duration', () => {
  const first = appendAction([], 2, 0, 30_000, 'orders')!;
  assert.equal(appendAction(first, 1, 0, 30_000, 'orders'), undefined);
  const second = appendAction(first, 1, 100, 30_000, 'orders')!;
  assert.deepEqual(second, [{ at: 0, choice: 2 }, { at: 100, choice: 1 }]);
  assert.equal(appendAction(second, 0, 30_001, 30_000, 'orders'), undefined);
  assert.equal(appendAction(second, 0, Number.NaN, 30_000, 'orders'), undefined);
});

test('delivery finish samples the current lane once and scores earned ticks without movement', () => {
  const seed = 17;
  const board = getGameBoard('delivery', seed);
  if (board.kind !== 'delivery') throw new Error('unexpected board');
  const lane = 1;
  assert.equal(board.ticks[0]!.bonusLane, lane);
  const finished = finalizeDeliveryActions([], lane, 2_500, 30_000);
  assert.deepEqual(finished, [{ at: 2_500, choice: lane }]);
  assert.equal(scoreRun('delivery', seed, []).score, 0);
  assert.equal(scoreRun('delivery', seed, finished).score, 100);
  assert.deepEqual(finalizeDeliveryActions([], lane, 30_001, 30_000), [{ at: 30_000, choice: lane }]);
});

test('delivery finish keeps the final sample valid after lane changes and at the action limit', () => {
  const actions = [{ at: 4_999, choice: 0 }];
  const finished = finalizeDeliveryActions(actions, 0, 5_000, 30_000);
  assert.deepEqual(finished, [...actions, { at: 5_000, choice: 0 }]);
  assert.doesNotThrow(() => scoreRun('delivery', 123, finished));
  assert.equal(finalizeDeliveryActions(actions, 2, 5_000, 30_000), actions);
  assert.equal(finalizeDeliveryActions(actions, 0, 4_999, 30_000), actions);
  assert.throws(() => scoreRun('delivery', 123, [...actions, { at: 5_000, choice: 2 }]), /INVALID_GAME_ACTIONS/);
  const full = Array.from({ length: 20 }, (_, at) => ({ at, choice: 1 }));
  assert.equal(finalizeDeliveryActions(full, 1, 20, 30_000), full);
  assert.equal(finalizeDeliveryActions([{ at: 30_000, choice: 1 }], 1, 30_000, 30_000).length, 1);
});

test('delivery manual finish scores a safe 4000 tick after a 3999.9 lane change', () => {
  const seed = 123;
  const board = getGameBoard('delivery', seed);
  if (board.kind !== 'delivery') throw new Error('unexpected board');
  assert.deepEqual(board.ticks[1], { at: 4_000, blockedLane: 1, bonusLane: 0 });
  const moveAt = 3_999.9;
  const actions = appendAction([], 0, moveAt, 30_000, 'delivery')!;
  assert.equal(scoreRun('delivery', seed, actions).score, 0);
  const intervalSample = finalizeDeliveryActions(actions, 0, 4_000.1, 30_000, moveAt);
  assert.equal(scoreRun('delivery', seed, intervalSample).score, 100);
  const finished = finalizeDeliveryActions(actions, 0, 4_000.2, 30_000, moveAt);
  assert.deepEqual(finished, [{ at: 3_999, choice: 0 }, { at: 4_000, choice: 0 }]);
  assert.equal(scoreRun('delivery', seed, finished).score, 100);
  assert.equal(scoreRunAtElapsed('delivery', seed, finished, 4_000.2).score, 100);
});

test('a mismatched second card stays visible with reduced motion', () => {
  assert.equal(memoryRevealDelay(false, true), 750);
  assert.equal(memoryRevealDelay(false, false), 750);
  assert.equal(memoryRevealDelay(true, false), 0);
});


test('delivery final sample rejects invalid lanes and stays monotonic at the duration boundary', () => {
  for (const lane of [-1, 3, 1.5, Number.NaN]) assert.deepEqual(finalizeDeliveryActions([], lane, 100, 30_000), []);
  assert.deepEqual(finalizeDeliveryActions([{ at: 29_999, choice: 0 }], 0, 30_001, 30_000),
    [{ at: 29_999, choice: 0 }, { at: 30_000, choice: 0 }]);
  assert.deepEqual(finalizeDeliveryActions([], 1, Number.NaN, 30_000), []);
});

// Fixed elapsed values stand in for real input arrival times; no clock or sleeps.
for (const kind of gameKinds) {
  test(`${kind}: fractional arrival times cannot round an early input into acceptance`, () => {
    const firstAt = 0.9;
    const first = appendAction([], 0, firstAt, 30_000, kind)!;
    const earlyAt = minimumActionGapMs[kind] + 0.1;
    assert.equal(appendAction(first, 0, earlyAt, 30_000, kind, firstAt), undefined);
    const next = appendAction(first, kind === 'stack' ? 0 : 1, firstAt + minimumActionGapMs[kind], 30_000, kind, firstAt)!;
    assert.equal(next.at(-1)!.at, minimumActionGapMs[kind]);
    assert.doesNotThrow(() => scoreRun(kind, 17, next));
  });
  test(`${kind}: fast input is ignored without modifying the accepted log`, () => {
    const gap = minimumActionGapMs[kind];
    const first = appendAction([], 0, 10, 30_000, kind)!;
    for (const at of [10, 11, 10 + gap - 1, 10 + gap - 0.1]) {
      assert.equal(appendAction(first, 1, at, 30_000, kind), undefined);
      assert.deepEqual(first, [{ at: 10, choice: 0 }]);
    }
    const accepted = appendAction(first, kind === 'stack' ? 0 : 1, 10 + gap, 30_000, kind)!;
    assert.deepEqual(accepted.at(-1), { at: 10 + gap, choice: kind === 'stack' ? 0 : 1 });
    assert.doesNotThrow(() => scoreRun(kind, 17, accepted));
  });
}

for (const kind of ['stack', 'memory', 'orders'] as const) {
  test(`${kind}: client-built completed logs satisfy server scoring and minimum real elapsed time`, () => {
    for (const seed of [0, 17, 123, 2147483647]) {
      const board = getGameBoard(kind, seed);
      const choices = board.kind === 'stack' ? board.rounds.map(() => 0)
        : board.kind === 'orders' ? board.orders.flat()
          : board.kind === 'memory' ? Array.from({ length: 6 }, (_, value) =>
            board.cards.flatMap((card, index) => card === value ? [index] : [])).flat() : [];
      let actions: readonly GameAction[] = [];
      choices.forEach((choice, index) => {
        const at = index * minimumActionGapMs[kind];
        if (index > 0) {
          // Includes the next pair immediately after reduced-motion reveal.
          if (kind === 'memory') assert.equal(memoryRevealDelay(true, false), 0);
          assert.equal(appendAction(actions, choice, at - 1, 30_000, kind), undefined);
        }
        actions = appendAction(actions, choice, at, 30_000, kind)!;
        assert.equal(actions.at(-1)!.at, at);
        assert.doesNotThrow(() => scoreRun(kind, seed, actions));
      });
      const elapsed = actions.at(-1)!.at;
      assert.equal(elapsed, minimumCompletedElapsedMs(kind, seed));
      assert.equal(scoreRun(kind, seed, actions).completed, true);
      assert.equal(scoreRunAtElapsed(kind, seed, actions, elapsed).completed, true);
      assert.throws(() => scoreRunAtElapsed(kind, seed, actions, elapsed - 1), /INVALID_GAME_ACTIONS/);
    }
  });
}

test('delivery: rapid lane changes are dropped and manual/auto finish preserve the accepted lane', () => {
  let actions: readonly GameAction[] = [];
  let lane = 1;
  for (const [choice, at] of [[0, 100], [2, 101], [2, 249], [2, 250], [0, 4_999]] as const) {
    const next = appendAction(actions, choice, at, 30_000, 'delivery');
    if (next) { actions = next; lane = choice; }
    assert.doesNotThrow(() => scoreRun('delivery', 123, actions));
  }
  assert.deepEqual(actions, [{ at: 100, choice: 0 }, { at: 250, choice: 2 }, { at: 4_999, choice: 0 }]);
  assert.equal(lane, 0);
  const manual = finalizeDeliveryActions(actions, lane, 5_000, 30_000);
  assert.equal(manual.at(-1)!.choice, actions.at(-1)!.choice);
  assert.equal(scoreRunAtElapsed('delivery', 123, manual, 5_000).completed, false);
  const lastMove = appendAction(actions, 2, 23_999, 30_000, 'delivery')!;
  const automatic = finalizeDeliveryActions(lastMove, 2, 24_000, 30_000);
  assert.equal(scoreRun('delivery', 123, automatic).completed, true);
  assert.equal(scoreRunAtElapsed('delivery', 123, automatic, 24_000).completed, true);
  const duration = finalizeDeliveryActions(lastMove, 2, 30_050, 30_000);
  assert.equal(duration.at(-1)!.at, 30_000);
  assert.doesNotThrow(() => scoreRunAtElapsed('delivery', 123, duration, 30_050));
});

test('delivery final sampling uses the observed integer millisecond without moving past it', () => {
  const actions = appendAction([], 0, 4_999.9, 30_000, 'delivery')!;
  assert.deepEqual(finalizeDeliveryActions(actions, 0, 5_000.1, 30_000, 4_999.9),
    [...actions, { at: 5_000, choice: 0 }]);
  assert.equal(finalizeDeliveryActions(actions, 0, 4_999.95, 30_000, 4_999.9), actions);
  const final = finalizeDeliveryActions(actions, 0, 5_000.9, 30_000, 4_999.9);
  assert.deepEqual(final, [...actions, { at: 5_000, choice: 0 }]);
  assert.doesNotThrow(() => scoreRun('delivery', 17, final));
});

test('delivery auto finish accepts the last tick after a sub-millisecond gap', () => {
  const moveAt = 23_999.9;
  const actions = appendAction([], 0, moveAt, 30_000, 'delivery')!;
  const early = finalizeDeliveryActions(actions, 0, 24_000.1, 30_000, moveAt);
  assert.deepEqual(early, [...actions, { at: 24_000, choice: 0 }]);
  assert.equal(shouldWaitForDeliverySample(early, 24_000.1, 30_000, 24_000), false);
  assert.equal(scoreRunAtElapsed('delivery', 17, early, 24_000.1).completed, true);
  const ready = finalizeDeliveryActions(actions, 0, 24_001, 30_000, moveAt);
  assert.equal(shouldWaitForDeliverySample(ready, 24_001, 30_000, 24_000), false);
  assert.equal(scoreRun('delivery', 17, ready).completed, true);
  assert.equal(scoreRunAtElapsed('delivery', 17, ready, 24_001).completed, true);
  // An earlier manual finish and the hard duration boundary never wait.
  assert.equal(shouldWaitForDeliverySample([{ at: 4_999, choice: 0 }], 5_000, 30_000, 24_000), false);
  assert.equal(shouldWaitForDeliverySample(early, 30_000, 30_000, 24_000), false);
});

test('delivery keeps an equal integer timestamp that already scores its tick', () => {
  const actions = appendAction([], 0, 4_000.1, 30_000, 'delivery')!;
  const finished = finalizeDeliveryActions(actions, 0, 4_000.2, 30_000, 4_000.1);
  assert.equal(finished, actions);
  assert.equal(scoreRunAtElapsed('delivery', 123, finished, 4_000.2).score, 100);
});
