import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FRIEND_CODE_LENGTH,
  formatFriendCode,
  friendCodeAccessibilityLabel,
  friendLink,
  friendCodeProblemMessage,
  friendLinkProblemMessage,
  friendShareMessage,
  normalizeFriendCode,
  parseFriendLink,
  parseScannedFriendCode,
  readFriendLink,
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
  assert.equal(friendLink('K7M2Q9XP', 'production'), 'https://masscom.kr/open#friend=K7M2Q9XP');
  assert.equal(friendLink('K7M2Q9XP', 'development'), 'https://masscom.kr/open#friend=K7M2Q9XP');
  assert.doesNotMatch(friendLink('K7M2Q9XP'), /\?/);
  const message = friendShareMessage('K7M2Q9XP');
  assert.match(message, /K7M2-Q9XP/);
  assert.ok(message.includes('https://masscom.kr/open#friend=K7M2Q9XP'));
  assert.match(message, /월계 마스코트/);
  assert.throws(() => friendLink('short'), /FRIEND_CODE_INVALID/);
});

test('the showcase build puts its own scheme link in the QR and never an https link that cannot open', () => {
  assert.equal(friendLink('K7M2Q9XP', 'showcase'), 'masscom-demo://open#friend=K7M2Q9XP');
  assert.doesNotMatch(friendLink('K7M2Q9XP', 'showcase'), /https?:|demo\.masscom\.kr/);
  // The QR is read back by the showcase scanner and the phone's camera app, and by no other build.
  assert.equal(parseFriendLink(friendLink('K7M2Q9XP', 'showcase'), 'showcase'), 'K7M2Q9XP');
  assert.equal(parseFriendLink(friendLink('K7M2Q9XP', 'showcase'), 'production'), undefined);
  assert.equal(parseFriendLink(friendLink('K7M2Q9XP', 'production'), 'showcase'), undefined);
});

test('the showcase share text carries the code and the download link, and no link to open', () => {
  assert.equal(
    friendShareMessage('K7M2Q9XP', 'showcase'),
    'MassCOM 시연 앱 친구 코드: K7M2-Q9XP\n앱의 친구 탭에서 코드를 넣어 주세요.\n앱 받기: https://masscom.kr/open',
  );
  assert.doesNotMatch(friendShareMessage('K7M2Q9XP', 'showcase'), /#friend=|demo\.masscom\.kr|masscom-demo/);
});

test('reads a friend code from the fragment of this build\'s own open link', () => {
  assert.equal(parseFriendLink('https://masscom.kr/open#friend=K7M2Q9XP', 'production'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://www.masscom.kr/open/#friend=K7M2Q9XP', 'production'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('HTTPS://MASSCOM.KR/open#friend=K7M2Q9XP', 'production'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom://open#friend=K7M2Q9XP', 'production'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://demo.masscom.kr/open#friend=K7M2Q9XP', 'showcase'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom-demo://open#friend=K7M2Q9XP', 'showcase'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('masscom-dev:///open#friend=K7M2Q9XP', 'development'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://masscom.kr/open#friend=K7M2Q9XP', 'development'), 'K7M2Q9XP');
  // A hand-typed or pasted code may be lower case or hyphenated; other fragment keys are ignored.
  assert.equal(parseFriendLink('https://masscom.kr/open#friend=k7m2-q9xp', 'production'), 'K7M2Q9XP');
  assert.equal(parseFriendLink('https://masscom.kr/open#utm=x&friend=K7M2Q9XP', 'production'), 'K7M2Q9XP');
});

test('a friend link of another build is never read as a code for this one', () => {
  const foreign: [string, 'production' | 'showcase' | 'development'][] = [
    ['masscom-demo://open#friend=K7M2Q9XP', 'production'],
    ['https://demo.masscom.kr/open#friend=K7M2Q9XP', 'production'],
    ['masscom-dev://open#friend=K7M2Q9XP', 'production'],
    ['https://masscom.kr/open#friend=K7M2Q9XP', 'showcase'],
    ['masscom://open#friend=K7M2Q9XP', 'showcase'],
    ['masscom-dev://open#friend=K7M2Q9XP', 'showcase'],
    ['masscom://open#friend=K7M2Q9XP', 'development'],
    ['masscom-demo://open#friend=K7M2Q9XP', 'development'],
    ['https://demo.masscom.kr/open#friend=K7M2Q9XP', 'development'],
  ];
  for (const [url, variant] of foreign) {
    assert.equal(parseFriendLink(url, variant), undefined, `${variant} ${url}`);
    assert.deepEqual(readFriendLink(url, variant), { kind: 'other-app' }, `${variant} ${url}`);
  }
  // Only a link that carries a friend value is a friend link; another build's merchant link says nothing about a code.
  assert.deepEqual(readFriendLink('masscom-demo://open#merchant=m1', 'production'), { kind: 'none' });
  // A bad code from another build is still that build's: no complaint about a code we never read.
  assert.deepEqual(readFriendLink('masscom-demo://open#friend=BAD', 'production'), { kind: 'other-app' });
});

test('says what a link holds: a code, a broken code, another build\'s code, or nothing', () => {
  assert.deepEqual(readFriendLink('https://masscom.kr/open#friend=k7m2-q9xp', 'production'), { kind: 'code', code: 'K7M2Q9XP' });
  assert.deepEqual(readFriendLink('https://masscom.kr/open#friend=BADCODE', 'production'), { kind: 'malformed' });
  assert.deepEqual(readFriendLink('https://masscom.kr/open#friend=', 'production'), { kind: 'malformed' });
  assert.deepEqual(readFriendLink('https://masscom.kr/open#friend=K7M2Q9X0', 'production'), { kind: 'malformed' });
  assert.deepEqual(readFriendLink('https://masscom.kr/open#other=1', 'production'), { kind: 'none' });
  assert.deepEqual(readFriendLink('https://masscom.kr/open', 'production'), { kind: 'none' });
  assert.deepEqual(readFriendLink('K7M2Q9XP', 'production'), { kind: 'none' });
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
  for (const url of rejected) assert.equal(parseFriendLink(url, 'production'), undefined, url);
});

test('says what is wrong with a typed code in plain Korean', () => {
  assert.match(friendCodeProblemMessage('EMPTY'), /입력/);
  assert.match(friendCodeProblemMessage('TOO_SHORT'), /8자리/);
  assert.match(friendCodeProblemMessage('TOO_LONG'), /8자리/);
  assert.match(friendCodeProblemMessage('INVALID_CHARACTER'), /0·O·1·I/);
});

test('one plain line says why a friend link cannot be used', () => {
  assert.equal(friendLinkProblemMessage('MALFORMED'), '링크의 친구 코드가 올바르지 않아요.');
  assert.equal(
    friendLinkProblemMessage('OTHER_APP'),
    '다른 MassCOM 앱(시연/운영)의 코드예요. 같은 앱끼리만 친구가 될 수 있어요.',
  );
});

test('a scanned QR is a friend link or a bare code and nothing else is passed on', () => {
  assert.deepEqual(parseScannedFriendCode('https://masscom.kr/open#friend=K7M2Q9XP', 'production'), { ok: true, code: 'K7M2Q9XP' });
  assert.deepEqual(parseScannedFriendCode('  masscom://open#friend=k7m2-q9xp\n', 'production'), { ok: true, code: 'K7M2Q9XP' });
  assert.deepEqual(parseScannedFriendCode('masscom-demo://open#friend=K7M2Q9XP', 'showcase'), { ok: true, code: 'K7M2Q9XP' });
  assert.deepEqual(parseScannedFriendCode('K7M2-Q9XP', 'production'), { ok: true, code: 'K7M2Q9XP' });
  assert.deepEqual(parseScannedFriendCode('', 'production'), { ok: false, reason: 'EMPTY' });
  for (const other of [
    'https://example.com/pay?to=K7M2Q9XP',
    'https://masscom.kr/open?friend=K7M2Q9XP',
    'https://masscom.kr/open#merchant=m1',
    'WIFI:S:home;P:secret;;',
    'masscom-customer:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'K7M2Q9X',
  ]) assert.deepEqual(parseScannedFriendCode(other, 'production'), { ok: false, reason: 'NOT_A_FRIEND_CODE' }, other);
});

test('a friend QR from another MassCOM build is refused before any request, whichever build reads it', () => {
  const cases: [string, 'production' | 'showcase' | 'development'][] = [
    ['masscom-demo://open#friend=K7M2Q9XP', 'production'],
    ['https://masscom.kr/open#friend=K7M2Q9XP', 'showcase'],
    ['masscom://open#friend=K7M2Q9XP', 'showcase'],
    ['masscom://open#friend=K7M2Q9XP', 'development'],
    ['masscom-dev://open#friend=K7M2Q9XP', 'production'],
  ];
  for (const [qr, variant] of cases) {
    assert.deepEqual(parseScannedFriendCode(qr, variant), { ok: false, reason: 'OTHER_APP' }, `${variant} ${qr}`);
  }
  // A bare code says nothing about which build made it, so it still goes to the API.
  assert.deepEqual(parseScannedFriendCode('K7M2Q9XP', 'showcase'), { ok: true, code: 'K7M2Q9XP' });
});
