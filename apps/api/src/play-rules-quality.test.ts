import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getGameBoard } from './play-rules.js';
import { evaluateQualityGameSkill, getQualityGameState } from './play-rules-quality.js';

test('stack placement inherits the previous physical overlap and stops on a miss', () => {
  const first = getQualityGameState('stack', 17, [{ at: 0, choice: 0 }], 0);
  assert.equal(first.kind, 'stack');
  if (first.kind !== 'stack') return;
  assert.equal(first.placed.length, 1);
  assert.ok(first.remainingWidth > 0 && first.remainingWidth <= 60);
  const second = getQualityGameState('stack', 17, [{ at: 0, choice: 0 }, { at: 150, choice: 0 }], 150);
  assert.equal(second.kind, 'stack');
  if (second.kind !== 'stack') return;
  assert.ok(second.remainingWidth <= first.remainingWidth);
  assert.equal(second.placed[1]?.width, second.remainingWidth);
  assert.throws(() => getQualityGameState('stack', 17,
    [{ at: 0, choice: 0 }, { at: 149, choice: 0 }], 150), /INVALID_GAME_ACTIONS/);
});

test('orders can be corrected before submission, and wrong submission resets current combo', () => {
  const board = getGameBoard('orders', 17);
  if (board.kind !== 'orders') throw new Error('unexpected board');
  const first = board.orders[0]!;
  const corrected = [first[0]!, (first[1]! + 1) % 4, 5, first[1]!, first[2]!, 4]
    .map((choice, index) => ({ at: index * 100, choice }));
  const state = getQualityGameState('orders', 17, corrected, 500);
  assert.equal(state.kind, 'orders');
  if (state.kind !== 'orders') return;
  assert.equal(state.orderIndex, 1);
  assert.deepEqual(state.tray, []);
  assert.equal(state.combo, 3);
  const wrong = getQualityGameState('orders', 17, [...corrected,
    { at: 600, choice: 0 }, { at: 700, choice: 4 }], 700);
  assert.equal(wrong.kind, 'orders');
  if (wrong.kind !== 'orders') return;
  assert.equal(wrong.orderIndex, 1);
  assert.equal(wrong.combo, 0);
  assert.equal(wrong.bestCombo, 3);
  assert.deepEqual(wrong.tray, [0]);
  assert.equal(wrong.wrongSubmissions, 1);
});

test('delivery loses cargo on the third collision and only arrives with cargo remaining', () => {
  const board = getGameBoard('delivery', 17);
  if (board.kind !== 'delivery') throw new Error('unexpected board');
  const collisions = board.ticks.slice(0, 3).map((tick) => ({ at: tick.at, choice: tick.blockedLane }));
  const failed = getQualityGameState('delivery', 17, collisions, 24_000);
  assert.equal(failed.kind, 'delivery');
  if (failed.kind !== 'delivery') return;
  assert.equal(failed.failed, true);
  assert.equal(failed.cargoHealth, 0);
  assert.equal(failed.completed, false);
  const safe = board.ticks.map((tick) => ({ at: tick.at, choice: tick.bonusLane }));
  const arrived = getQualityGameState('delivery', 17, safe, 24_000);
  assert.equal(arrived.kind, 'delivery');
  if (arrived.kind !== 'delivery') return;
  assert.equal(arrived.arrived, true);
  assert.equal(arrived.cargoHealth, 3);
  assert.equal(evaluateQualityGameSkill(arrived).achieved, true);
});

test('memory keeps matched cards and rejects selecting an already found pair', () => {
  const board = getGameBoard('memory', 17);
  if (board.kind !== 'memory') throw new Error('unexpected board');
  const pair = board.cards.flatMap((symbol, index) => symbol === board.cards[0] ? [index] : []);
  const state = getQualityGameState('memory', 17, pair.map((choice, index) => ({ at: index * 80, choice })), 80);
  assert.equal(state.kind, 'memory');
  if (state.kind !== 'memory') return;
  assert.deepEqual(state.matchedIndices.sort((a, b) => a - b), pair);
  assert.throws(() => getQualityGameState('memory', 17,
    [...pair, pair[0]!].map((choice, index) => ({ at: index * 80, choice })), 160), /INVALID_GAME_ACTIONS/);
});

test('seeded stack preserves the center at perfect placement and rejects input after a physical miss', () => {
  const perfect = [172, 541, 1011, 1212, 1711, 2387].map(at => ({ at, choice: 0 }));
  const state = getQualityGameState('stack', 17, perfect, 2387);
  if (state.kind !== 'stack') throw new Error('unexpected state');
  assert.deepEqual(state.placed, Array.from({ length: 6 }, () => ({ left: 20, width: 60, center: 50, overlap: 60 })));
  assert.equal(state.score, 600);
  assert.equal(state.completed, true);
  assert.equal(evaluateQualityGameSkill(state).achieved, true);
  const miss = [0, 150, 590].map(at => ({ at, choice: 0 }));
  const failed = getQualityGameState('stack', 17, miss, 590);
  assert.equal(failed.failed, true);
  assert.equal(failed.completed, false);
  assert.throws(() => getQualityGameState('stack', 17, [...miss, { at: 740, choice: 0 }], 740), /INVALID_GAME_ACTIONS/);
});

test('quality rules enforce every action cap, choices, monotonic input gaps and elapsed bounds', () => {
  for (const [kind, cap, choices, gap] of [
    ['stack', 6, 1, 150], ['memory', 36, 12, 80], ['delivery', 20, 3, 150], ['orders', 60, 7, 100],
  ] as const) {
    const rejected = (actions: unknown, elapsed = 30_000) => assert.throws(() =>
      getQualityGameState(kind, 17, actions as Parameters<typeof getQualityGameState>[2], elapsed), /INVALID_GAME_ACTIONS/);
    rejected(Array.from({ length: cap + 1 }, (_, index) => ({ at: index * gap, choice: 0 })));
    for (const at of [-1, 0.5, 30_001, NaN, Infinity]) rejected([{ at, choice: 0 }]);
    for (const choice of [-1, choices, 0.5, '0', null]) rejected([{ at: 0, choice }]);
    rejected([{ at: 0, choice: 0 }, { at: 0, choice: 0 }]);
    rejected([{ at: 0, choice: 0 }, { at: gap - 1, choice: kind === 'stack' ? 0 : 1 }]);
    rejected([{ at: 2001, choice: 0 }], 0);
    for (const elapsed of [-1, NaN, Infinity]) rejected([], elapsed);
    rejected([null]);
  }
  const sampled = getQualityGameState('delivery', 17, [{ at: 1999, choice: 1 }, { at: 2000, choice: 1 }], 2000);
  assert.equal(sampled.kind, 'delivery');
  assert.throws(() => getQualityGameState('delivery', 17,
    [{ at: 1999, choice: 1 }, { at: 2000, choice: 0 }], 2000), /INVALID_GAME_ACTIONS/);
});

test('orders compare quantities as a multiset and wrong trays can be cleared and retried', () => {
  const board = getGameBoard('orders', 17);
  if (board.kind !== 'orders') throw new Error('unexpected board');
  const wrong = [board.orders[0]![0]!, 4, 6];
  const choices = [...wrong, ...board.orders.flatMap(order => [...order].reverse().concat(4))];
  const state = getQualityGameState('orders', 17, choices.map((choice, index) => ({ at: index * 100, choice })), 1800);
  if (state.kind !== 'orders') throw new Error('unexpected state');
  assert.equal(state.completed, true);
  assert.equal(state.orderIndex, 4);
  assert.equal(state.wrongSubmissions, 1);
  assert.equal(state.score, 1090);
  assert.deepEqual(state.tray, []);
  assert.equal(evaluateQualityGameSkill(state).achieved, true);
  assert.throws(() => getQualityGameState('orders', 17,
    [0, 1, 2, 3].map((choice, index) => ({ at: index * 100, choice })), 300), /INVALID_GAME_ACTIONS/);
});
