import assert from 'node:assert/strict';
import { test } from 'node:test';

import { consumePendingFriendCode, peekPendingFriendCode, rememberPendingFriendCode } from './pending-friend-link';

test('a friend code from a link waits for sign-in and is handed over exactly once', () => {
  assert.equal(consumePendingFriendCode(), undefined);
  rememberPendingFriendCode('K7M2Q9XP');
  assert.equal(peekPendingFriendCode(), 'K7M2Q9XP');
  assert.equal(consumePendingFriendCode(), 'K7M2Q9XP');
  assert.equal(consumePendingFriendCode(), undefined);
});

test('a newer link replaces an older one and undefined clears it', () => {
  rememberPendingFriendCode('K7M2Q9XP');
  rememberPendingFriendCode('23456789');
  assert.equal(consumePendingFriendCode(), '23456789');
  rememberPendingFriendCode('K7M2Q9XP');
  rememberPendingFriendCode(undefined);
  assert.equal(peekPendingFriendCode(), undefined);
});
