import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FriendsApiError,
  UNNAMED_SHOP,
  createFriendsApiClient,
  friendsErrorMessage,
  parseAddedFriend,
  parseFriendsSnapshot,
  replyNeedsRefresh,
  rotateFailureCopy,
} from './friends-api';

const friendA = '11111111-1111-4111-8111-111111111111';

function medals(explorer: number, regular: number, steady: number) {
  return [
    { key: 'explorer', tier: explorer },
    { key: 'regular', tier: regular },
    { key: 'steady', tier: steady },
  ];
}

function friend(overrides: Record<string, unknown> = {}) {
  return {
    friendshipId: friendA, nickname: '민지', badges: { earned: 5, total: 9 }, medals: medals(2, 2, 1),
    stamps: [{ merchantName: '월계 국밥집' }, { merchantName: '월계 분식' }], rank: 1,
    ...overrides,
  };
}

function snapshot() {
  return {
    me: {
      nickname: '탐험가 K7M2', code: 'K7M2Q9XP', badges: { earned: 3, total: 9 }, medals: medals(1, 1, 1),
      rank: 2, asOf: '2026-09-28',
    },
    friends: [friend()],
  };
}

test('parses the friends list and keeps only the allowed fields', () => {
  const raw = snapshot();
  (raw.friends[0] as Record<string, unknown>).accountId = 'acct-secret';
  (raw.friends[0] as Record<string, unknown>).visitDates = ['2026-09-01'];
  (raw.friends[0]!.stamps[0] as Record<string, unknown>).visitedAt = '2026-09-01';
  const parsed = parseFriendsSnapshot(raw);
  assert.equal(parsed.me.code, 'K7M2Q9XP');
  assert.equal(parsed.me.rank, 2);
  assert.equal(parsed.me.asOf, '2026-09-28');
  assert.deepEqual(parsed.friends[0], {
    friendshipId: friendA, nickname: '민지', badges: { earned: 5, total: 9 }, medals: medals(2, 2, 1),
    stamps: [{ merchantName: '월계 국밥집' }, { merchantName: '월계 분식' }], rank: 1,
  });
  assert.deepEqual(Object.keys(parsed.friends[0]!.stamps[0]!), ['merchantName']);
  assert.deepEqual(Object.keys(parsed.me), ['nickname', 'code', 'badges', 'medals', 'rank', 'asOf']);
});

test('puts medals in the fixed explorer, regular, steady order', () => {
  const raw = snapshot();
  raw.friends[0]!.medals.reverse();
  assert.deepEqual(parseFriendsSnapshot(raw).friends[0]!.medals.map((medal) => medal.key), ['explorer', 'regular', 'steady']);
});

test('an empty friends list is a valid snapshot where I am first', () => {
  const raw = snapshot();
  raw.friends = [];
  raw.me.rank = 1;
  assert.deepEqual(parseFriendsSnapshot(raw).friends, []);
});

test('rejects a snapshot that is not the documented shape instead of showing guesses', () => {
  const cases: [string, (raw: ReturnType<typeof snapshot>) => void][] = [
    ['bad code alphabet', (raw) => { raw.me.code = 'K7M2Q9X0'; }],
    ['short code', (raw) => { raw.me.code = 'K7M2Q9X'; }],
    ['empty nickname', (raw) => { raw.me.nickname = '  '; }],
    ['nickname over 12 characters', (raw) => { raw.me.nickname = '가'.repeat(13); }],
    ['badge total not 9', (raw) => { raw.me.badges.total = 10; }],
    ['badges above total', (raw) => { raw.me.badges.earned = 10; }],
    ['badges not the sum of medal tiers', (raw) => { raw.me.badges.earned = 4; }],
    ['medal tier out of range', (raw) => { raw.me.medals[0]!.tier = 4; }],
    ['unknown medal key', (raw) => { raw.me.medals[0]!.key = 'secret'; }],
    ['duplicate medal key', (raw) => { raw.me.medals[1]!.key = 'explorer'; }],
    ['missing medal', (raw) => { raw.me.medals.pop(); }],
    ['bad asOf', (raw) => { raw.me.asOf = 'yesterday'; }],
    ['impossible asOf date', (raw) => { raw.me.asOf = '2026-02-30'; }],
    ['rank zero', (raw) => { raw.me.rank = 0; }],
    ['rank not an integer', (raw) => { raw.me.rank = 1.5; }],
    ['friendshipId not a uuid', (raw) => { raw.friends[0]!.friendshipId = 'acct-1'; }],
    ['friend nickname missing', (raw) => { delete (raw.friends[0] as Record<string, unknown>).nickname; }],
    ['friend badges not the sum of tiers', (raw) => { raw.friends[0]!.badges.earned = 9; }],
    ['stamp without a name field', (raw) => { (raw.friends[0]!.stamps as unknown[])[0] = {}; }],
    ['stamp name not a string', (raw) => { (raw.friends[0]!.stamps as unknown[])[0] = { merchantName: 5 }; }],
    ['stamp that is not an object', (raw) => { (raw.friends[0]!.stamps as unknown[])[0] = '월계 국밥집'; }],
    ['stamps not a list', (raw) => { (raw.friends[0] as Record<string, unknown>).stamps = {}; }],
    ['duplicate friendshipId', (raw) => { raw.friends.push(friend({ rank: 3 })); raw.me.rank = 2; }],
    ['ranks that skip a place', (raw) => { raw.me.rank = 3; }],
    ['two entries with the same rank', (raw) => { raw.friends[0]!.rank = 2; }],
  ];
  for (const [label, mutate] of cases) {
    const raw = snapshot();
    mutate(raw);
    assert.throws(() => parseFriendsSnapshot(raw), (error: unknown) =>
      error instanceof FriendsApiError && error.code === 'INVALID_RESPONSE', label);
  }
  for (const value of [null, [], 'x', {}, { me: {}, friends: [] }, { me: snapshot().me }, { friends: [] }]) {
    assert.throws(() => parseFriendsSnapshot(value), FriendsApiError);
  }
});

test('one stamp whose shop name is blank shows as an unnamed shop instead of hiding the whole list', () => {
  assert.equal(UNNAMED_SHOP, '이름 없는 가게');
  for (const blank of ['', ' ', '   ', '\t\n', '\u3000', '\u3000 \u00a0\u2003', '\ufeff']) {
    const raw = snapshot();
    raw.friends[0]!.stamps = [{ merchantName: '월계 국밥집' }, { merchantName: blank }, { merchantName: '월계 분식' }];
    const parsed = parseFriendsSnapshot(raw);
    assert.deepEqual(
      parsed.friends[0]!.stamps.map((stamp) => stamp.merchantName),
      ['월계 국밥집', UNNAMED_SHOP, '월계 분식'],
      JSON.stringify(blank),
    );
  }
  // The other friends and my own numbers are read as usual, and a real name is left exactly as the server wrote it.
  const raw = snapshot();
  raw.friends[0]!.stamps = [{ merchantName: ' 월계 국밥집 ' }, { merchantName: '\u3000' }];
  const parsed = parseFriendsSnapshot(raw);
  assert.equal(parsed.friends[0]!.stamps[0]!.merchantName, ' 월계 국밥집 ');
  assert.equal(parsed.me.code, 'K7M2Q9XP');
  assert.equal(parsed.friends[0]!.rank, 1);
});

test('only an unreadable reply asks for a reload: every other failure keeps what is on screen', () => {
  assert.equal(replyNeedsRefresh(new FriendsApiError(200, 'INVALID_RESPONSE')), true);
  for (const error of [
    new FriendsApiError(0, 'NETWORK_ERROR'),
    new FriendsApiError(429, 'FRIEND_CODE_RATE_LIMITED', 60),
    new FriendsApiError(400, 'FRIEND_NICKNAME_INVALID'),
    new Error('INVALID_RESPONSE'),
    undefined,
    'INVALID_RESPONSE',
  ]) assert.equal(replyNeedsRefresh(error), false);
});

test('the new-code prompt after unfriending claims a failure only when the server really refused', () => {
  const refused = rotateFailureCopy(new FriendsApiError(0, 'NETWORK_ERROR'));
  assert.equal(refused.title, '코드를 바꾸지 못했어요');
  assert.match(refused.body, /^네트워크에 연결하지 못했어요/);
  assert.match(refused.body, /친구 탭에서 다시 바꿀 수 있어요\.$/);
  assert.equal(rotateFailureCopy(new FriendsApiError(429, 'FRIEND_CODE_RATE_LIMITED', 60)).title, '코드를 바꾸지 못했어요');
  assert.equal(rotateFailureCopy(new TypeError('x')).title, '코드를 바꾸지 못했어요');
  // An unreadable reply may follow a code the server did rotate: no failure is claimed, and the friends tab is named.
  const unreadable = rotateFailureCopy(new FriendsApiError(200, 'INVALID_RESPONSE'));
  assert.doesNotMatch(`${unreadable.title} ${unreadable.body}`, /못했어요\.? *$|바꾸지 못|다시 바꿀/);
  assert.match(unreadable.body, /친구 탭에/);
  assert.match(unreadable.body, /새 코드/);
  assert.notEqual(unreadable.title, refused.title);
  for (const copy of [refused, unreadable]) {
    assert.doesNotMatch(`${copy.title} ${copy.body}`, /INVALID_RESPONSE|NETWORK_ERROR|[A-Z]{4,}/, 'no raw codes');
  }
});

test('parses an added friend with its created flag', () => {
  const added = parseAddedFriend({ friend: friend({ rank: 2 }), created: true });
  assert.equal(added.created, true);
  assert.equal(added.friend.nickname, '민지');
  assert.equal(parseAddedFriend({ friend: friend({ rank: 2 }), created: false }).created, false);
  assert.throws(() => parseAddedFriend({ friend: friend(), created: 'yes' }), FriendsApiError);
  assert.throws(() => parseAddedFriend({ created: true }), FriendsApiError);
  assert.throws(() => parseAddedFriend({ friend: friend({ nickname: '' }), created: true }), FriendsApiError);
});

test('sends the credential and the documented request for each call', async () => {
  const calls: { url: string; method: string | undefined; body: unknown; auth: string | null }[] = [];
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test/',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const url = String(input);
      calls.push({
        url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined,
        auth: new Headers(init?.headers).get('authorization'),
      });
      if (url.endsWith('/me/friends') && init?.method === 'POST') return Response.json({ friend: friend({ rank: 2 }), created: true }, { status: 201 });
      if (url.endsWith('/me/friends')) return Response.json(snapshot());
      if (url.endsWith('/rotate')) return Response.json({ code: '23456789' });
      if (url.endsWith('/me/profile')) return Response.json({ nickname: '새 별명' });
      return Response.json({ status: 'REMOVED' });
    },
  });
  assert.equal((await client.getFriends()).me.code, 'K7M2Q9XP');
  assert.equal((await client.addFriend('K7M2Q9XP')).created, true);
  await client.removeFriend(friendA);
  assert.equal(await client.rotateCode(), '23456789');
  assert.equal(await client.setNickname('새 별명'), '새 별명');
  assert.deepEqual(calls.map((call) => [call.method ?? 'GET', call.url]), [
    ['GET', 'https://api.example.test/me/friends'],
    ['POST', 'https://api.example.test/me/friends'],
    ['DELETE', `https://api.example.test/me/friends/${friendA}`],
    ['POST', 'https://api.example.test/me/friend-code/rotate'],
    ['PUT', 'https://api.example.test/me/profile'],
  ]);
  assert.deepEqual(calls[1]!.body, { code: 'K7M2Q9XP' });
  assert.deepEqual(calls[3]!.body, {});
  assert.deepEqual(calls[4]!.body, { nickname: '새 별명' });
  for (const call of calls) assert.equal(call.auth, 'Bearer session');
  for (const call of calls) assert.equal(call.url.includes('K7M2Q9XP'), false, 'the code never rides in a URL');
});

test('the demo credential is sent as the account header', async () => {
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'customer-1');
      return Response.json(snapshot());
    },
  });
  await client.getFriends();
});

test('the add call sends the code as typed after normalising, and refuses an invalid one without a request', async () => {
  let requests = 0;
  const bodies: unknown[] = [];
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_input, init) => {
      requests += 1;
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ friend: friend({ rank: 2 }), created: false });
    },
  });
  await client.addFriend('k7m2-q9xp');
  assert.deepEqual(bodies, [{ code: 'K7M2Q9XP' }]);
  await assert.rejects(client.addFriend('0000'), (error: unknown) =>
    error instanceof FriendsApiError && error.code === 'FRIEND_CODE_NOT_FOUND');
  assert.equal(requests, 1);
  await assert.rejects(client.removeFriend('not-a-uuid'), (error: unknown) =>
    error instanceof FriendsApiError && error.code === 'FRIEND_NOT_FOUND');
  assert.equal(requests, 1);
});

test('rejects malformed success bodies from every call', async () => {
  const bodies = [{ nope: true }, { nope: true }, { status: 'OK' }, { code: 'short' }, { nickname: '' }];
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json(bodies.shift()),
  });
  const invalid = (error: unknown) => error instanceof FriendsApiError && error.code === 'INVALID_RESPONSE';
  await assert.rejects(client.getFriends(), invalid);
  await assert.rejects(client.addFriend('K7M2Q9XP'), invalid);
  await assert.rejects(client.removeFriend(friendA), invalid);
  await assert.rejects(client.rotateCode(), invalid);
  await assert.rejects(client.setNickname('별명'), invalid);
});

test('maps API failures to codes, reads Retry-After and invalidates only an expired bearer session', async () => {
  let invalidated = 0;
  const responses = [
    Response.json({ code: 'FRIEND_CODE_NOT_FOUND' }, { status: 404 }),
    Response.json({ code: 'FRIEND_CODE_RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '540' } }),
    Response.json({ code: 'FRIEND_CODE_RATE_LIMITED' }, { status: 429 }),
    Response.json({ code: 'SESSION_INVALID' }, { status: 401 }),
    new Response('<html>bad gateway</html>', { status: 502 }),
    Response.json({ code: 'ACCOUNT_DELETED' }, { status: 410 }),
  ];
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    onSessionInvalid: () => { invalidated += 1; },
    fetcher: async () => responses.shift()!,
  });
  await assert.rejects(client.addFriend('K7M2Q9XP'), (error: unknown) =>
    error instanceof FriendsApiError && error.status === 404 && error.code === 'FRIEND_CODE_NOT_FOUND');
  await assert.rejects(client.addFriend('K7M2Q9XP'), (error: unknown) =>
    error instanceof FriendsApiError && error.status === 429 && error.retryAfterSeconds === 540);
  await assert.rejects(client.addFriend('K7M2Q9XP'), (error: unknown) =>
    error instanceof FriendsApiError && error.status === 429 && error.retryAfterSeconds === undefined);
  await assert.rejects(client.getFriends(), (error: unknown) =>
    error instanceof FriendsApiError && error.code === 'SESSION_INVALID');
  await assert.rejects(client.getFriends(), (error: unknown) =>
    error instanceof FriendsApiError && error.code === 'HTTP_502');
  await assert.rejects(client.getFriends(), (error: unknown) =>
    error instanceof FriendsApiError && error.status === 410 && error.code === 'ACCOUNT_DELETED');
  assert.equal(invalidated, 1);
});

test('a network failure becomes a code, not a raw error', async () => {
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => { throw new TypeError('Network request failed'); },
  });
  await assert.rejects(client.getFriends(), (error: unknown) =>
    error instanceof FriendsApiError && error.status === 0 && error.code === 'NETWORK_ERROR');
});

test('a successful response that is not JSON is rejected', async () => {
  const client = createFriendsApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => new Response('ok', { status: 200 }),
  });
  await assert.rejects(client.getFriends(), (error: unknown) =>
    error instanceof FriendsApiError && error.code === 'INVALID_RESPONSE');
});

test('speaks plainly in Korean for every failure a person can hit', () => {
  const error = (status: number, code: string, retryAfterSeconds?: number) => new FriendsApiError(status, code, retryAfterSeconds);
  // A missing code and a code from someone who cut me off read the same, so neither leaks which it was.
  const notFound = friendsErrorMessage(error(404, 'FRIEND_CODE_NOT_FOUND'));
  assert.match(notFound, /^코드를 찾지 못했어요/);
  assert.equal(friendsErrorMessage(error(404, 'FRIEND_CODE_NOT_FOUND')), notFound);
  assert.match(friendsErrorMessage(error(409, 'FRIEND_SELF')), /내 코드/);
  assert.match(friendsErrorMessage(error(409, 'FRIEND_LIMIT')), /100명/);
  assert.equal(friendsErrorMessage(error(429, 'FRIEND_CODE_RATE_LIMITED', 540)), '잠시 후 다시 시도해 주세요 (9분)');
  assert.equal(friendsErrorMessage(error(429, 'FRIEND_CODE_RATE_LIMITED', 61)), '잠시 후 다시 시도해 주세요 (2분)');
  assert.equal(friendsErrorMessage(error(429, 'FRIEND_CODE_RATE_LIMITED', 5)), '잠시 후 다시 시도해 주세요 (1분)');
  assert.equal(friendsErrorMessage(error(429, 'FRIEND_CODE_RATE_LIMITED')), '잠시 후 다시 시도해 주세요');
  assert.match(friendsErrorMessage(error(410, 'ACCOUNT_DELETED')), /삭제/);
  assert.match(friendsErrorMessage(error(400, 'FRIEND_NICKNAME_INVALID')), /별명/);
  assert.match(friendsErrorMessage(error(404, 'FRIEND_NOT_FOUND')), /이미 끊어진/);
  assert.match(friendsErrorMessage(error(503, 'FRIENDS_NOT_CONFIGURED')), /아직/);
  assert.match(friendsErrorMessage(error(401, 'SESSION_INVALID')), /로그인/);
  assert.match(friendsErrorMessage(error(0, 'NETWORK_ERROR')), /네트워크/);
  assert.match(friendsErrorMessage(error(200, 'INVALID_RESPONSE')), /응답/);
  assert.match(friendsErrorMessage(error(500, 'HTTP_500')), /잠시/);
  assert.match(friendsErrorMessage(new TypeError('x')), /네트워크/);
  for (const value of [notFound, friendsErrorMessage(error(500, 'HTTP_500'))]) {
    assert.doesNotMatch(value, /FRIEND_|HTTP_|ACCOUNT_|[A-Z]{4,}/, 'no raw codes in what a person reads');
  }
});
