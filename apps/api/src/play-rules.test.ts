import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gameDurationMs, getGameBoard, scoreRun, stackCursor } from './play-rules.js';

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
