import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PENDING_FRIEND_CODE_TTL_MS,
  clearPendingFriendLink,
  consumePendingFriendCode,
  consumePendingFriendProblem,
  hasPendingFriendLink,
  peekPendingFriendCode,
  rememberPendingFriendCode,
  rememberPendingFriendProblem,
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

test('a friend link that could not be used waits as a problem, said once, and is forgotten the same ways', () => {
  rememberPendingFriendProblem('MALFORMED');
  assert.equal(hasPendingFriendLink(), true);
  // A problem is not a code: the add prompt never sees it, and asking for the code leaves the problem waiting.
  assert.equal(peekPendingFriendCode(), undefined);
  assert.equal(consumePendingFriendCode(), undefined);
  assert.equal(consumePendingFriendProblem(), 'MALFORMED');
  assert.equal(consumePendingFriendProblem(), undefined);
  assert.equal(hasPendingFriendLink(), false);

  rememberPendingFriendProblem('OTHER_APP');
  clearPendingFriendLink();
  assert.equal(consumePendingFriendProblem(), undefined);

  // The newest link wins, whichever kind it is.
  rememberPendingFriendProblem('OTHER_APP');
  rememberPendingFriendCode('K7M2Q9XP');
  assert.equal(consumePendingFriendProblem(), undefined);
  assert.equal(consumePendingFriendCode(), 'K7M2Q9XP');
  rememberPendingFriendCode('K7M2Q9XP');
  rememberPendingFriendProblem('MALFORMED');
  assert.equal(consumePendingFriendCode(), undefined);
  assert.equal(consumePendingFriendProblem(), 'MALFORMED');
});

test('a waiting problem also expires after half an hour', () => {
  const start = 2_000_000;
  rememberPendingFriendProblem('OTHER_APP', start);
  assert.equal(hasPendingFriendLink(start + PENDING_FRIEND_CODE_TTL_MS - 1), true);
  assert.equal(hasPendingFriendLink(start + PENDING_FRIEND_CODE_TTL_MS), false);
  assert.equal(consumePendingFriendProblem(start + PENDING_FRIEND_CODE_TTL_MS), undefined);
});
