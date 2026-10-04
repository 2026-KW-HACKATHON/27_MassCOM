import assert from 'node:assert/strict';
import test from 'node:test';
import { getGameBoard, scoreRun } from '../../../api/src/play-rules';
import { appendAction, finalizeDeliveryActions, memoryRevealDelay } from './run-actions';

test('actions are integer, strictly increasing and stop at the run duration', () => {
  const first = appendAction([], 2, 0, 30_000)!;
  const second = appendAction(first, 1, 0, 30_000)!;
  assert.deepEqual(second, [{ at: 0, choice: 2 }, { at: 1, choice: 1 }]);
  assert.equal(appendAction(second, 0, 30_001, 30_000), undefined);
  assert.equal(appendAction(second, 0, Number.NaN, 30_000), undefined);
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
  const finished = finalizeDeliveryActions(actions, 2, 4_999, 30_000);
  assert.deepEqual(finished, [...actions, { at: 5_000, choice: 2 }]);
  assert.doesNotThrow(() => scoreRun('delivery', 123, finished));
  const full = Array.from({ length: 20 }, (_, at) => ({ at, choice: 1 }));
  assert.equal(finalizeDeliveryActions(full, 1, 20, 30_000), full);
  assert.equal(finalizeDeliveryActions([{ at: 30_000, choice: 1 }], 1, 30_000, 30_000).length, 1);
});

test('a mismatched second card stays visible with reduced motion', () => {
  assert.equal(memoryRevealDelay(false, true), 750);
  assert.equal(memoryRevealDelay(false, false), 750);
  assert.equal(memoryRevealDelay(true, false), 0);
});


test('delivery final sample rejects invalid lanes and stays monotonic at the duration boundary', () => {
  for (const lane of [-1, 3, 1.5, Number.NaN]) assert.deepEqual(finalizeDeliveryActions([], lane, 100, 30_000), []);
  assert.deepEqual(finalizeDeliveryActions([{ at: 29_999, choice: 0 }], 2, 29_999, 30_000),
    [{ at: 29_999, choice: 0 }, { at: 30_000, choice: 2 }]);
  assert.deepEqual(finalizeDeliveryActions([], 1, Number.NaN, 30_000), []);
});
