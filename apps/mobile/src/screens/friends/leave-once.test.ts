import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLeaveOnce } from './leave-once';

test('leaves on the first ask and ignores every repeated ask', () => {
  let left = 0;
  const guard = createLeaveOnce(() => { left += 1; });
  assert.equal(left, 0, 'nothing happens until asked');
  guard.run();
  guard.run();
  guard.run();
  assert.equal(left, 1);
});

test('does nothing once the screen is disposed, whether or not it has been asked before', () => {
  let left = 0;
  const gone = createLeaveOnce(() => { left += 1; });
  gone.dispose();
  gone.run();
  assert.equal(left, 0);

  const already = createLeaveOnce(() => { left += 1; });
  already.run();
  already.dispose();
  already.run();
  assert.equal(left, 1);
});

test('disposing more than once is harmless and each guard counts on its own', () => {
  let first = 0;
  let second = 0;
  const a = createLeaveOnce(() => { first += 1; });
  const b = createLeaveOnce(() => { second += 1; });
  a.dispose();
  a.dispose();
  b.run();
  a.run();
  assert.deepEqual([first, second], [0, 1]);
});
