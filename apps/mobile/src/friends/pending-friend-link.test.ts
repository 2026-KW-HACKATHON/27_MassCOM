import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PENDING_FRIEND_CODE_TTL_MS,
  consumePendingFriendCode,
  peekPendingFriendCode,
  rememberPendingFriendCode,
} from './pending-friend-link';

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

test('a code nobody claimed does not linger: it is forgotten after half an hour', () => {
  const start = 1_000_000;
  rememberPendingFriendCode('K7M2Q9XP', start);
  assert.equal(peekPendingFriendCode(start + PENDING_FRIEND_CODE_TTL_MS - 1), 'K7M2Q9XP');
  assert.equal(peekPendingFriendCode(start + PENDING_FRIEND_CODE_TTL_MS), undefined);
  assert.equal(consumePendingFriendCode(start + PENDING_FRIEND_CODE_TTL_MS), undefined);
  assert.equal(PENDING_FRIEND_CODE_TTL_MS, 30 * 60 * 1000);
  // Expired means gone, not merely hidden: a later look with an earlier clock finds nothing either.
  assert.equal(peekPendingFriendCode(start), undefined);
});
