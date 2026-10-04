import assert from 'node:assert/strict';
import test from 'node:test';
import { appendAction } from './run-actions';

test('actions are integer, strictly increasing and stop at the run duration', () => {
  const first = appendAction([], 2, 0, 30_000)!;
  const second = appendAction(first, 1, 0, 30_000)!;
  assert.deepEqual(second, [{ at: 0, choice: 2 }, { at: 1, choice: 1 }]);
  assert.equal(appendAction(second, 0, 30_001, 30_000), undefined);
  assert.equal(appendAction(second, 0, Number.NaN, 30_000), undefined);
});
