import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FRIEND_CODE_LENGTH,
  formatFriendCode,
  friendCodeAccessibilityLabel,
  friendLink,
  friendShareMessage,
  normalizeFriendCode,
  parseFriendLink,
  validateFriendCode,
} from './code';

test('normalises what a person types or pastes: upper case, no spaces or hyphens', () => {
  assert.equal(normalizeFriendCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeFriendCode('  ab cd\tef gh \n'), 'ABCDEFGH');
  assert.equal(normalizeFriendCode('ab‐cd–ef−gh'), 'ABCDEFGH');
  assert.equal(normalizeFriendCode('k7m2-q9xp'), 'K7M2Q9XP');
  assert.equal(normalizeFriendCode(''), '');
});

test('a valid code is eight characters from the 32-letter table without 0, O, 1 and I', () => {
  assert.equal(FRIEND_CODE_LENGTH, 8);
  assert.deepEqual(validateFriendCode('ABCD-EFGH'), { ok: true, code: 'ABCDEFGH' });
  assert.deepEqual(validateFriendCode('k7m2 q9xp'), { ok: true, code: 'K7M2Q9XP' });
  assert.deepEqual(validateFriendCode('23456789'), { ok: true, code: '23456789' });
  assert.deepEqual(validateFriendCode(''), { ok: false, reason: 'EMPTY' });
  assert.deepEqual(validateFriendCode(' - '), { ok: false, reason: 'EMPTY' });
  assert.deepEqual(validateFriendCode('ABCDEFG'), { ok: false, reason: 'TOO_SHORT' });
  assert.deepEqual(validateFriendCode('ABCDEFGHJ'), { ok: false, reason: 'TOO_LONG' });
  for (const confusing of ['ABCDEFG0', 'ABCDEFGO', 'ABCDEFG1', 'ABCDEFGI', 'ABCDEFG!', 'ABCDEFG가']) {
    assert.deepEqual(validateFriendCode(confusing), { ok: false, reason: 'INVALID_CHARACTER' }, confusing);
  }
});

test('a code is shown in two groups of four and read out letter by letter', () => {
  assert.equal(formatFriendCode('K7M2Q9XP'), 'K7M2-Q9XP');
  assert.equal(friendCodeAccessibilityLabel('K7M2Q9XP'), '친구 코드 K, 7, M, 2, Q, 9, X, P');
});

test('builds the share link with the code in the fragment, never in the query', () => {
  assert.equal(friendLink('K7M2Q9XP'), 'https://masscom.kr/open#friend=K7M2Q9XP');
  assert.equal(friendLink('K7M2Q9XP', 'https://demo.masscom.kr'), 'https://demo.masscom.kr/open#friend=K7M2Q9XP');
  assert.doesNotMatch(friendLink('K7M2Q9XP'), /\?/);
  const message = friendShareMessage('K7M2Q9XP');
  assert.match(message, /K7M2-Q9XP/);
  assert.ok(message.includes('https://masscom.kr/open#friend=K7M2Q9XP'));
  assert.match(message, /월계 마스코트/);
  assert.throws(() => friendLink('short'), /FRIEND_CODE_INVALID/);
});

test('reads a friend code from the fragment of the https app link and the custom schemes', () => {
  assert.equal(parseFriendLink('https://masscom.kr/open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://demo.masscom.kr/open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://www.masscom.kr/open/#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('HTTPS://MASSCOM.KR/open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom://open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom-demo://open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom-dev:///open#friend=K7M2Q9XP'), 'K7M2Q9XP');
  // A hand-typed or pasted code may be lower case or hyphenated; other fragment keys are ignored.
  assert.equal(parseFriendLink('https://masscom.kr/open#friend=k7m2-q9xp'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://masscom.kr/open#utm=x&friend=K7M2Q9XP'), 'K7M2Q9XP');
});

test('ignores a code in the query and anything that is not our open link', () => {
  const rejected = [
    'https://masscom.kr/open?friend=K7M2Q9XP',
    'https://masscom.kr/open?friend=K7M2Q9XP#friend=',
    'https://masscom.kr/open',
    'https://masscom.kr/other#friend=K7M2Q9XP',
    'https://masscom.kr.evil.test/open#friend=K7M2Q9XP',
    'https://evil.test/open#friend=K7M2Q9XP',
    'https://user@masscom.kr/open#friend=K7M2Q9XP',
    'https://masscom.kr:8443/open#friend=K7M2Q9XP',
    'http://masscom.kr/open#friend=K7M2Q9XP',
    'other://open#friend=K7M2Q9XP',
    'masscom://elsewhere#friend=K7M2Q9XP',
    'https://masscom.kr/open#friend=K7M2Q9X',
    'https://masscom.kr/open#friend=K7M2Q9X0',
    'https://masscom.kr/open#friend=%zz',
    'https://masscom.kr/open#merchant=abc',
    'K7M2Q9XP',
    '',
  ];
  for (const url of rejected) assert.equal(parseFriendLink(url), undefined, url);
});
