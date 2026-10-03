import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMedals } from './badge-rules.js';
import {
  buildFriendsSnapshot,
  defaultNicknamePrefix,
  friendCodeAlphabet,
  friendCodePattern,
  friendsAsOf,
  generateDefaultNickname,
  generateFriendCode,
  isFriendCode,
  normalizeFriendCode,
  orderAccountPair,
  parseNickname,
  serializeFriendView,
  type FriendSource,
} from './friends-rules.js';

const asOf = '2026-09-28';
const medalsFor = (explorer: number, regular = 0, steady = 0) => buildMedals({ explorer, regular, steady });
const friend = (id: string, nickname: string, explorer: number, stamps: string[] = []): FriendSource => ({
  friendshipId: id, nickname, medals: medalsFor(explorer),
  stamps: stamps.map((merchantName) => ({ merchantName, merchantId: null })),
});

test('the friend code alphabet has 32 unambiguous characters and matches the stored pattern', () => {
  assert.equal(friendCodeAlphabet.length, 32);
  assert.equal(new Set(friendCodeAlphabet).size, 32);
  for (const banned of ['0', 'O', '1', 'I']) assert.equal(friendCodeAlphabet.includes(banned), false, banned);
  for (const char of friendCodeAlphabet) assert.match(char, /^[2-9A-HJ-NP-Z]$/);
  assert.equal(friendCodePattern.source, '^[2-9A-HJ-NP-Z]{8}$');
});

test('generated codes are 8 characters from the alphabet and use every alphabet slot evenly', () => {
  for (let index = 0; index < 500; index++) {
    const code = generateFriendCode();
    assert.equal(code.length, 8);
    assert.equal(isFriendCode(code), true, code);
  }
  // 하위 5비트가 그대로 글자 번호가 되므로 0..255 바이트는 32글자를 정확히 8번씩 고른다.
  const counts = new Map<string, number>();
  for (let base = 0; base < 256; base += 8) {
    const code = generateFriendCode(() => Uint8Array.from({ length: 8 }, (_, offset) => base + offset));
    for (const char of code) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  assert.equal(counts.size, 32);
  assert.deepEqual([...new Set(counts.values())], [8]);
  assert.equal(generateFriendCode(() => new Uint8Array(8)), '22222222');
  assert.equal(generateFriendCode(() => new Uint8Array(8).fill(31)), 'ZZZZZZZZ');
});

test('code normalization uppercases and strips spaces and hyphens only', () => {
  assert.equal(normalizeFriendCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeFriendCode(' ab cd\tef\ngh '), 'ABCDEFGH');
  assert.equal(normalizeFriendCode('ABCD‐EFGH−'), 'ABCDEFGH');
  assert.equal(normalizeFriendCode('k7m2-p9qx'), 'K7M2P9QX');
  assert.equal(isFriendCode(normalizeFriendCode('k7m2-p9qx')), true);
  // 헷갈리는 글자는 고쳐 주지 않고 그대로 두어 유효하지 않은 코드가 된다.
  assert.equal(isFriendCode(normalizeFriendCode('K7M2-P9Q0')), false);
  assert.equal(isFriendCode(normalizeFriendCode('K7M2P9Q')), false);
  assert.equal(isFriendCode('K7M2P9QXX'), false);
  assert.equal(isFriendCode(''), false);
});

test('the default nickname is 탐험가 plus four characters from its own random draw, never from a code', () => {
  assert.equal(defaultNicknamePrefix, '탐험가');
  assert.equal(generateDefaultNickname(() => new Uint8Array(4)), '탐험가 2222');
  assert.equal(generateDefaultNickname(() => new Uint8Array(4).fill(31)), '탐험가 ZZZZ');
  // 하위 5비트가 글자 번호다. 코드와 같은 32글자 표를 쓴다.
  assert.equal(generateDefaultNickname(() => Uint8Array.from([0, 1, 2, 3])), '탐험가 2345');
  const sizes: number[] = [];
  generateDefaultNickname((size) => { sizes.push(size); return new Uint8Array(size); });
  assert.deepEqual(sizes, [4]);
  for (let index = 0; index < 500; index++) {
    const nickname = generateDefaultNickname();
    assert.match(nickname, /^탐험가 [2-9A-HJ-NP-Z]{4}$/, nickname);
    assert.equal(parseNickname(nickname), nickname);
  }
  // 코드 생성과 별개의 난수다: 같은 바이트를 줘도 코드 함수를 거치지 않고, 서로 다른 호출은 서로 다른 값을 낸다.
  const draws = new Set(Array.from({ length: 200 }, () => generateDefaultNickname()));
  assert.ok(draws.size > 150, String(draws.size));
});

test('nicknames are trimmed, limited to 12 code points and reject URL, email and invisible characters', () => {
  assert.equal(parseNickname('  탐험가  '), '탐험가');
  assert.equal(parseNickname('a'), 'a');
  assert.equal(parseNickname('열두글자열두글자열두글자'), '열두글자열두글자열두글자');
  assert.equal(parseNickname('열두글자열두글자열두글자!'), null);
  assert.equal(parseNickname(`${'😀'.repeat(11)}a`), `${'😀'.repeat(11)}a`);
  assert.equal(parseNickname(`${'😀'.repeat(12)}a`), null);
  for (const invalid of [
    '', '   ', '\t\n', 'a@b.com', '@handle', 'https://x.kr', 'http:evil', 'www.evil', 'evil.com', 'go.kr/x', 'MAILTO:a',
    'a\nb', 'a\u0000b', 'a​b', 'a‮b',
  ]) {
    assert.equal(parseNickname(invalid), null, JSON.stringify(invalid));
  }
  for (const invalid of [undefined, null, 1, {}, ['a']]) assert.equal(parseNickname(invalid), null);
  // 점이 들어가도 주소 모양이 아니면 허용한다.
  assert.equal(parseNickname('J.K'), 'J.K');
  assert.equal(parseNickname('맛집 탐험가 1호'), '맛집 탐험가 1호');
  assert.equal(parseNickname('Dr. Kim'), 'Dr. Kim');
  assert.equal(parseNickname('3.14 탐험가'), '3.14 탐험가');
  assert.equal(parseNickname('café'), 'café');
  assert.equal(parseNickname('cafe\u0301'), 'cafe\u0301');
});

test('nicknames reject domain look-alikes that hide behind other scripts, TLDs or full-width dots', () => {
  for (const address of [
    '맛집.com', '카페.kr', 'abc.club', 'x.blog', 'evil.to', 'a-b.dev',
    // NFKC로 풀리는 전각 글자와 점.
    'ｗｗｗ．ｘ．ｃｏｍ', 'ｅｖｉｌ．ｃｏｍ', 'ｅｖｉｌ。ｃｏｍ', 'bit。ly/abc', 'bit｡ly', 'x．blog',
  ]) {
    assert.equal(parseNickname(address), null, address);
  }
});

test('nicknames reject blank-looking fillers, private-use, unassigned and lone surrogate code points', () => {
  for (const filler of ['\u3164', '\u115F', '\u1160', '\uFFA0', '\u2800']) {
    const label = `U+${filler.codePointAt(0)!.toString(16).toUpperCase()}`;
    assert.equal(parseNickname(filler), null, label);
    assert.equal(parseNickname(filler.repeat(6)), null, `${label} x6`);
    assert.equal(parseNickname(`a${filler}b`), null, `a${label}b`);
    assert.equal(parseNickname(`${filler}${filler}가`), null, `${label} before a letter`);
  }
  assert.equal(parseNickname('\uE000'), null, 'private use');
  assert.equal(parseNickname('a\uE000'), null, 'private use next to a letter');
  assert.equal(parseNickname('\u{10FFFF}'), null, 'private use plane 16');
  assert.equal(parseNickname('a\u0378'), null, 'unassigned');
  assert.equal(parseNickname('a\uD800'), null, 'lone high surrogate');
  assert.equal(parseNickname('a\uDC00'), null, 'lone low surrogate');
  // 글자나 숫자가 하나도 없는 별명(기호·공백·표식만)은 빈 칸과 같다.
  for (const empty of ['...', '---', '!?', '\u0301', '\u0301\u0301', '☆★']) {
    assert.equal(parseNickname(empty), null, JSON.stringify(empty));
  }
  assert.equal(parseNickname('★가'), '★가');
  assert.equal(parseNickname('#1'), '#1');
});

test('nicknames cap combining marks at two per base and four in total', () => {
  const acute = '\u0301';
  assert.equal(parseNickname(`a${acute}${acute}`), `a${acute}${acute}`);
  assert.equal(parseNickname(`a${acute}${acute}${acute}`), null);
  // 여러 글자에 두 개씩 붙이면 글자마다는 통과해도 합계 4개를 넘지 못한다.
  assert.equal(parseNickname(`a${acute}${acute}b${acute}${acute}`), `a${acute}${acute}b${acute}${acute}`);
  assert.equal(parseNickname(`a${acute}${acute}b${acute}${acute}c${acute}`), null);
  // 흔한 zalgo 글자와 표식만 잔뜩 붙은 별명.
  assert.equal(parseNickname('z̴̡̛̗̻͈̥͓̈́̎̕a̷̘l̶g̷o̵'), null);
  assert.equal(parseNickname(`a${'\u0300\u0301\u0302\u0303\u0304\u0305'}`), null);
  assert.equal(parseNickname(`${acute.repeat(5)}가`), null);
  // 글자마다 표식 하나씩 네 개까지는 통과하고, NFKC로 합쳐져 사본에서 표식이 사라져도 원문 개수로 다섯 개째부터 막는다.
  assert.equal(parseNickname('e\u0301 e\u0301 e\u0301 e\u0301'), 'e\u0301 e\u0301 e\u0301 e\u0301');
  assert.equal(parseNickname('e\u0301e\u0301e\u0301e\u0301e\u0301'), null);
});

test('friends data counts through yesterday in KST: asOf is the previous KST date and flips at KST midnight', () => {
  // 2026-09-29 09:00 KST → 어제는 9월 28일.
  assert.equal(friendsAsOf(new Date('2026-09-29T00:00:00.000Z')), '2026-09-28');
  // KST 자정 직전(9월 28일 23:59:59.999)에는 아직 9월 28일이라 어제는 27일이고, 자정에 28일로 넘어간다.
  assert.equal(friendsAsOf(new Date('2026-09-28T14:59:59.999Z')), '2026-09-27');
  assert.equal(friendsAsOf(new Date('2026-09-28T15:00:00.000Z')), '2026-09-28');
  // 월·연도 경계와 UTC 날짜가 KST 날짜와 다른 시간대.
  assert.equal(friendsAsOf(new Date('2026-10-01T00:00:00.000Z')), '2026-09-30');
  assert.equal(friendsAsOf(new Date('2026-12-31T15:00:00.000Z')), '2026-12-31');
  assert.equal(friendsAsOf(new Date('2027-01-01T14:59:59.999Z')), '2026-12-31');
  assert.equal(friendsAsOf(new Date('2028-03-01T00:00:00.000Z')), '2028-02-29');
  assert.match(friendsAsOf(new Date()), /^\d{4}-\d{2}-\d{2}$/);
});

test('friendship pairs are ordered by UTF-8 byte order regardless of argument order', () => {
  assert.deepEqual(orderAccountPair('b', 'a'), { low: 'a', high: 'b' });
  assert.deepEqual(orderAccountPair('a', 'b'), { low: 'a', high: 'b' });
  assert.deepEqual(orderAccountPair('Z', 'a'), { low: 'Z', high: 'a' });
  assert.deepEqual(orderAccountPair('가', 'a'), { low: 'a', high: '가' });
  // UTF-16 코드 단위 순서와 UTF-8 바이트 순서가 갈리는 경우(U+FF5E 대 U+1F600)는 바이트 순서를 따른다.
  assert.deepEqual(orderAccountPair('～', '\u{1F600}'), { low: '～', high: '\u{1F600}' });
  assert.ok('\u{1F600}' < '～', 'UTF-16 order differs, which is why the byte order is used');
});

test('the friend view exposes exactly the allowed key set and drops everything else', () => {
  const polluted = {
    friendshipId: '0d2b8e3c-3f51-4ea3-9a53-0c2c5d0c8a11',
    nickname: '별명',
    medals: medalsFor(3, 2, 4),
    stamps: [
      { merchantName: '가게 A', merchantId: 'm-1', visitedAt: '2026-09-01', visits: 4 },
      { merchantName: '비공개 가게', merchantId: null, privateMerchantId: 'hidden-id', visits: 2 },
    ],
    accountId: 'google-123', email: 'a@b.c', coupons: [{ id: 1 }], wallet: '0xabc', businessDate: '2026-09-01',
  } as unknown as FriendSource;
  const view = serializeFriendView(polluted, 2);
  assert.deepEqual(Object.keys(view).sort(), ['badges', 'friendshipId', 'medals', 'nickname', 'rank', 'stamps']);
  assert.deepEqual(Object.keys(view.badges).sort(), ['earned', 'total']);
  for (const medal of view.medals) assert.deepEqual(Object.keys(medal).sort(), ['key', 'tier']);
  for (const stamp of view.stamps) assert.deepEqual(Object.keys(stamp), ['merchantName', 'merchantId']);
  assert.deepEqual(view, {
    friendshipId: '0d2b8e3c-3f51-4ea3-9a53-0c2c5d0c8a11',
    nickname: '별명',
    badges: { earned: 3 + 2 + 1, total: 9 },
    medals: [{ key: 'explorer', tier: 3 }, { key: 'regular', tier: 1 }, { key: 'steady', tier: 2 }],
    stamps: [{ merchantName: '가게 A', merchantId: 'm-1' }, { merchantName: '비공개 가게', merchantId: null }],
    rank: 2,
  });
  const text = JSON.stringify(view);
  for (const leaked of ['google-123', 'a@b.c', 'coupons', '0xabc', '2026-09-01', 'visits', 'hidden-id']) {
    assert.equal(text.includes(leaked), false, leaked);
  }
});

test('the snapshot ranks me and friends by badges, then stamps, then nickname', () => {
  const snapshot = buildFriendsSnapshot(
    { nickname: '나', code: 'K7M2P9QX', medals: medalsFor(2), stampCount: 2, asOf },
    [
      friend('f-low', '가나다', 1, ['A']),
      friend('f-top', '최고', 3, ['A', 'B', 'C']),
      friend('f-tie-more-stamps', '도장왕', 2, ['A', 'B', 'C']),
      friend('f-tie-b', '바', 2, ['A', 'B']),
      friend('f-tie-a', '가', 2, ['A', 'B']),
    ],
  );
  assert.deepEqual(snapshot.friends.map((entry) => [entry.friendshipId, entry.rank]), [
    ['f-top', 1], ['f-tie-more-stamps', 2], ['f-tie-a', 3], ['f-tie-b', 5], ['f-low', 6],
  ]);
  // 배지 2개·도장 2개 동률에서 별명 "가" < "나" < "바"라 나는 4위다.
  assert.equal(snapshot.me.rank, 4);
  assert.deepEqual(Object.keys(snapshot.me).sort(), ['asOf', 'badges', 'code', 'medals', 'nickname', 'rank']);
  assert.equal(snapshot.me.asOf, asOf);
  assert.equal(snapshot.me.code, 'K7M2P9QX');
  assert.deepEqual(snapshot.me.badges, { earned: 2, total: 9 });
  assert.deepEqual(Object.keys(snapshot).sort(), ['friends', 'me']);
});

test('the snapshot with no friends still ranks me first and is stable for identical entries', () => {
  const alone = buildFriendsSnapshot({ nickname: '나', code: 'K7M2P9QX', medals: medalsFor(0), stampCount: 0, asOf }, []);
  assert.deepEqual(alone.friends, []);
  assert.equal(alone.me.rank, 1);
  assert.equal(alone.me.asOf, asOf);
  const twins = buildFriendsSnapshot(
    { nickname: '같은', code: 'K7M2P9QX', medals: medalsFor(1), stampCount: 1, asOf },
    [friend('b-id', '같은', 1, ['A']), friend('a-id', '같은', 1, ['A'])],
  );
  // 별명까지 같으면 나를 먼저, 친구는 관계 id 순으로 정해 매번 같은 순서가 나온다.
  assert.deepEqual(twins.friends.map((entry) => [entry.friendshipId, entry.rank]), [['a-id', 2], ['b-id', 3]]);
  assert.equal(twins.me.rank, 1);
});
