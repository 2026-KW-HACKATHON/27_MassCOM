import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHeldFriendCode } from './held-friend-code';

test('a code that arrives while my snapshot loads waits, and is handed over once when it is ready', () => {
  const held = createHeldFriendCode();
  assert.equal(held.arrive('K7M2Q9XP', 'loading'), undefined);
  assert.equal(held.settle('loading'), undefined, 'still loading: still waiting');
  assert.equal(held.settle('ready'), 'K7M2Q9XP');
  assert.equal(held.settle('ready'), undefined, 'handed over only once');
});

test('a failed load hands the code over too, so the dialog and the server\'s own refusal decide', () => {
  const held = createHeldFriendCode();
  held.arrive('K7M2Q9XP', 'loading');
  assert.equal(held.settle('error'), 'K7M2Q9XP');
  assert.equal(held.settle('error'), undefined);
});

test('a code that arrives once the snapshot is known, ready or failed, is acted on at once and nothing waits', () => {
  for (const status of ['ready', 'error'] as const) {
    const held = createHeldFriendCode();
    assert.equal(held.arrive('K7M2Q9XP', status), 'K7M2Q9XP', status);
    assert.equal(held.settle('ready'), undefined, status);
  }
});

test('settling with nothing waiting does nothing', () => {
  const held = createHeldFriendCode();
  for (const status of ['loading', 'ready', 'error'] as const) assert.equal(held.settle(status), undefined, status);
});

test('a newer code replaces the waiting one, and a code that can be acted on at once drops a stale waiting one', () => {
  const held = createHeldFriendCode();
  held.arrive('K7M2Q9XP', 'loading');
  held.arrive('23456789', 'loading');
  assert.equal(held.settle('ready'), '23456789');

  held.arrive('K7M2Q9XP', 'loading');
  assert.equal(held.arrive('23456789', 'ready'), '23456789');
  assert.equal(held.settle('ready'), undefined);
});

test('leaving the tab forgets a waiting code, so it cannot open a dialog over another screen', () => {
  const held = createHeldFriendCode();
  held.arrive('K7M2Q9XP', 'loading');
  held.clear();
  assert.equal(held.settle('ready'), undefined);
  held.clear();
});

test('my own code opened by a link is recognised as mine once my snapshot is in, not asked about while it loads', () => {
  const myCode = 'K7M2Q9XP';
  const seen: string[] = [];
  const confirm = (code: string, knownMine: string | undefined) => seen.push(code === knownMine ? 'own' : 'ask');
  const held = createHeldFriendCode();

  // Before the fix the tab judged the code straight away, with no code of mine yet: it asked about my own code.
  const early = held.arrive(myCode, 'loading');
  if (early !== undefined) confirm(early, undefined);
  assert.deepEqual(seen, []);

  const released = held.settle('ready');
  if (released !== undefined) confirm(released, myCode);
  assert.deepEqual(seen, ['own']);

  // Someone else's code takes the same road and is asked about.
  const other = held.arrive('23456789', 'loading');
  if (other !== undefined) confirm(other, undefined);
  const otherReleased = held.settle('ready');
  if (otherReleased !== undefined) confirm(otherReleased, myCode);
  assert.deepEqual(seen, ['own', 'ask']);
});
