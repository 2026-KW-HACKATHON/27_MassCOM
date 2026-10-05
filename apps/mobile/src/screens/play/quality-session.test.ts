import assert from 'node:assert/strict';
import test from 'node:test';
import { getGameBoard, stackCursor, type GameAction } from '../../../../api/src/play-rules';
import { getQualityGameState } from '../../../../api/src/play-rules-quality';
import { appendAction, finalizeDeliveryActions } from '../../play/run-actions';

test('order controls correct a wrong tray and serve recipes in any order', () => {
  const board = getGameBoard('orders', 41);
  assert.equal(board.kind, 'orders');
  if (board.kind !== 'orders') return;
  let actions: GameAction[] = [];
  const input = (choice: number) => {
    const next = appendAction(actions, choice, actions.length * 120, 30_000, 'orders');
    assert.ok(next); actions = next;
    return getQualityGameState('orders', 41, actions, actions.at(-1)!.at);
  };
  const first = board.orders[0]!;
  first.forEach(value => input((value + 1) % 4));
  const wrong = input(4);
  if (wrong.kind !== 'orders') return;
  assert.equal(wrong.orderIndex, 0); assert.equal(wrong.tray.length, 3);
  input(5); input(6);
  for (const recipe of board.orders) { [...recipe].reverse().forEach(input); input(4); }
  const result = getQualityGameState('orders', 41, actions, actions.at(-1)!.at);
  assert.equal(result.completed, true); assert.equal(result.correct, 12);
});

test('stack drop uses displayed time and retains overlap for the next box', () => {
  const board = getGameBoard('stack', 11);
  if (board.kind !== 'stack') return;
  const at = Array.from({ length: 2000 }, (_, index) => index).find(time => stackCursor(board.rounds[0]!, time) === 70)!;
  const visible = getQualityGameState('stack', 11, [], at);
  const actions = appendAction([], 0, at, 30_000, 'stack')!;
  const dropped = getQualityGameState('stack', 11, actions, at);
  if (visible.kind !== 'stack' || dropped.kind !== 'stack') return;
  const expected = Math.min(80, visible.current.left + 60) - Math.max(20, visible.current.left);
  assert.ok(Math.abs(dropped.remainingWidth - expected) < 0.001);
  assert.equal(dropped.current.width, dropped.remainingWidth);
});

test('final delivery sample observes lane and discovered memory pairs persist', () => {
  const delivery = finalizeDeliveryActions([{ at: 23_950, choice: 2 }], 2, 24_000, 30_000);
  assert.deepEqual(delivery.at(-1), { at: 24_000, choice: 2 });
  const board = getGameBoard('memory', 13);
  if (board.kind !== 'memory') return;
  const first = 0; const second = board.cards.findIndex((value, index) => index !== first && value === board.cards[first]);
  const state = getQualityGameState('memory', 13, [{ at: 0, choice: first }, { at: 100, choice: second }], 100);
  assert.equal(state.kind, 'memory');
  if (state.kind !== 'memory') return;
  assert.deepEqual(state.matchedIndices, [first, second]); assert.equal(state.correct, 1);
});
