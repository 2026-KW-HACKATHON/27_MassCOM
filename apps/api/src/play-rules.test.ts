import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gameDurationMs, getGameBoard, minimumActionGapMs, minimumCompletedElapsedMs, scoreRun, scoreRunAtElapsed, stackCursor } from './play-rules.js';

test('boards are deterministic and each game has its own input model', () => {
  for (const kind of ['stack', 'memory', 'delivery', 'orders'] as const) {
    assert.deepEqual(getGameBoard(kind, 17), getGameBoard(kind, 17));
    assert.notDeepEqual(getGameBoard(kind, 17), getGameBoard(kind, 18));
  }
  const memory = getGameBoard('memory', 17);
  assert.equal(memory.kind, 'memory');
  if (memory.kind === 'memory') {
    assert.deepEqual([...memory.cards].sort(), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  }
});

test('stack timing, memory pairs, delivery lanes, and order sequence produce distinct results', () => {
  const stack = getGameBoard('stack', 17);
  if (stack.kind !== 'stack') throw new Error('unexpected board');
  const stackActions = stack.rounds.map((round, index) => {
    const at = (index + 1) * 1000;
    assert.ok(stackCursor(round, at) >= 0);
    return { at, choice: 0 };
  });
  assert.equal(scoreRun('stack', 17, stackActions).completed, true);

  const memory = getGameBoard('memory', 17);
  if (memory.kind !== 'memory') throw new Error('unexpected board');
  const memoryActions = [...new Set(memory.cards)].flatMap((symbol, pair) =>
    memory.cards.flatMap((card, index) => card === symbol ? [{ at: pair * 2000 + index + 1, choice: index }] : []));
  // Pair selections must be ordered in time, independent of card index.
  memoryActions.forEach((action, index) => { action.at = index * 100 + 1; });
  assert.equal(scoreRun('memory', 17, memoryActions).correct, 6);
  assert.equal(scoreRun('memory', 17, memoryActions).completed, true);
  assert.throws(() => scoreRun('memory', 17, [memoryActions[0]!, { at: 2, choice: memoryActions[0]!.choice }]));

  const delivery = getGameBoard('delivery', 17);
  if (delivery.kind !== 'delivery') throw new Error('unexpected board');
  const deliveryActions = delivery.ticks.map((tick) => ({ at: tick.at, choice: tick.bonusLane }));
  assert.deepEqual(scoreRun('delivery', 17, deliveryActions),
    { score: 1200, completed: true, correct: 12, total: 12 });

  const orders = getGameBoard('orders', 17);
  if (orders.kind !== 'orders') throw new Error('unexpected board');
  assert.equal(scoreRun('orders', 17, orders.orders.flat().map((choice, index) =>
    ({ at: index * 100 + 1, choice }))).completed, true);
  assert.equal(scoreRun('orders', 17, []).completed, false);
});

test('rejects impossible action ranges and timing', () => {
  assert.throws(() => scoreRun('stack', 1, [{ at: gameDurationMs + 1, choice: 0 }]));
  assert.throws(() => scoreRun('stack', 1, [{ at: 1, choice: 0 }, { at: 1, choice: 0 }]));
  assert.throws(() => scoreRun('orders', 1, [{ at: 1, choice: 4 }]));
  assert.throws(() => getGameBoard('memory', -1));
});

test('instant scripted completions fail for every game; fast human logs pass', () => {
  const seed = 17;
  const expectedMinimum = { stack: 750, memory: 880, delivery: 24000, orders: 1100 } as const;
  const inputGap = { stack: 150, memory: 80, orders: 100 } as const;
  for (const kind of ['stack', 'memory', 'delivery', 'orders'] as const) {
    const board = getGameBoard(kind, seed);
    let actions: { at: number; choice: number }[];
    if (board.kind === 'stack') actions = board.rounds.map((_, index) => ({ at: (index + 1) * 300, choice: 0 }));
    else if (board.kind === 'memory') {
      actions = [...new Set(board.cards)].flatMap((symbol) => board.cards.flatMap((card, index) =>
        card === symbol ? [{ at: 0, choice: index }] : []));
      actions.forEach((action, index) => { action.at = (index + 1) * 140; });
    } else if (board.kind === 'delivery') actions = board.ticks.map((tick) => ({ at: tick.at, choice: tick.bonusLane }));
    else actions = board.orders.flat().map((choice, index) => ({ at: (index + 1) * 180, choice }));

    const minimumElapsed = minimumCompletedElapsedMs(kind, seed);
    assert.equal(minimumElapsed, expectedMinimum[kind], kind);
    assert.equal(scoreRunAtElapsed(kind, seed, actions, minimumElapsed).completed, true, kind);
    assert.throws(() => scoreRunAtElapsed(kind, seed, actions, minimumElapsed - 1), /INVALID_GAME_ACTIONS/, kind);
    if (kind !== 'delivery') {
      const paced = actions.map((action, index) => ({ ...action, at: index * inputGap[kind] }));
      assert.equal(scoreRunAtElapsed(kind, seed, paced, minimumElapsed).completed, true, kind);
      assert.throws(() => scoreRunAtElapsed(kind, seed, paced, minimumElapsed - 1), /INVALID_GAME_ACTIONS/, kind);
    }
    const instant = actions.map((action, index) => ({ ...action, at: index + 1 }));
    assert.throws(() => scoreRunAtElapsed(kind, seed, instant, 12), /INVALID_GAME_ACTIONS/, kind);
    assert.throws(() => scoreRunAtElapsed(kind, seed, instant, gameDurationMs), /INVALID_GAME_ACTIONS/,
      `${kind}: waiting before submission must not bypass input spacing`);
  }
});

test('client-shaped completed logs pass at each minimum gap and require minimum server elapsed', () => {
  const seed = 17;
  assert.deepEqual(minimumActionGapMs, { stack: 150, memory: 80, delivery: 150, orders: 100 });
  for (const kind of ['stack', 'memory', 'delivery', 'orders'] as const) {
    const board = getGameBoard(kind, seed);
    let actions: { at: number; choice: number }[];
    if (board.kind === 'stack') actions = board.rounds.map((_, index) =>
      ({ at: index * minimumActionGapMs.stack, choice: 0 }));
    else if (board.kind === 'memory') {
      actions = [...new Set(board.cards)].flatMap((symbol) => board.cards.flatMap((card, index) =>
        card === symbol ? [{ at: 0, choice: index }] : []));
      actions.forEach((action, index) => { action.at = index * minimumActionGapMs.memory; });
    } else if (board.kind === 'delivery') {
      actions = [{ at: 0, choice: 0 }, { at: minimumActionGapMs.delivery, choice: 2 },
        { at: 23999, choice: 1 }, { at: 24000, choice: 1 }];
    } else actions = board.orders.flat().map((choice, index) =>
      ({ at: index * minimumActionGapMs.orders, choice }));

    const minimumElapsed = minimumCompletedElapsedMs(kind, seed);
    assert.equal(scoreRunAtElapsed(kind, seed, actions, minimumElapsed).completed, true, kind);
    assert.throws(() => scoreRunAtElapsed(kind, seed, actions, minimumElapsed - 1), /INVALID_GAME_ACTIONS/, kind);
  }
});

test('each game accepts the minimum input gap and rejects a gap one millisecond short', () => {
  const seed = 17;
  for (const kind of ['stack', 'memory', 'delivery', 'orders'] as const) {
    const gap = minimumActionGapMs[kind];
    const board = getGameBoard(kind, seed);
    const choices = kind === 'memory' ? [0, 1] : kind === 'delivery' ? [1, 2] :
      board.kind === 'orders' ? board.orders[0]!.slice(0, 2) : [0, 0];
    const first = { at: 0, choice: choices[0]! };
    assert.doesNotThrow(() => scoreRun(kind, seed, [first, { at: gap, choice: choices[1]! }]), kind);
    assert.throws(() => scoreRun(kind, seed, [first, { at: gap - 1, choice: choices[1]! }]),
      /INVALID_GAME_ACTIONS/, kind);
  }
});

test('delivery final sample may repeat the current lane immediately after a move', () => {
  const actions = [{ at: 1000, choice: 2 }, { at: 23999, choice: 0 }, { at: 24000, choice: 0 }];
  assert.equal(scoreRunAtElapsed('delivery', 17, actions, 24000).completed, true);
  assert.equal(scoreRunAtElapsed('delivery', 17, [{ at: 1000, choice: 2 }, { at: 1050, choice: 2 }], 1050).completed,
    false, 'manual finish can append the current lane before the last tick');
  assert.equal(scoreRunAtElapsed('delivery', 17, [{ at: 1000, choice: 2 }, { at: 1001, choice: 2 }], 1001).completed,
    false, 'manual finish can append the current lane one millisecond after the last move');
  assert.throws(() => scoreRunAtElapsed('delivery', 17,
    [{ at: 1000, choice: 2 }, { at: 23999, choice: 0 }, { at: 24000, choice: 1 }], 24000),
  /INVALID_GAME_ACTIONS/);
});
