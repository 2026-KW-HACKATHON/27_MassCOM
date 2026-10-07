import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoomApiClient, normalizeRoomMessage, parsePublicRoom, parseRoomSettings, parseRoomStamp, parseRoomVisitors, roomErrorMessage, RoomApiError } from './room-api';

const publicRoom = { roomId: 'room-1', mine: false, studio: {
  nickname: '방 주인', studio: { theme: 'daylight', layout: 'shelf', accent: 'mint', goal: null },
  items: [{ merchantId: 'merchant-1', merchantName: '가게', campaignTitle: '수집', displayName: '코인' }], avatar: null,
}, stamps: [{ id: 'stamp-1', kind: 'COZY', createdAt: '2026-10-07T12:00:00.000Z', mine: true, authorNickname: '방문자' }] };

test('public room parser discards private account and entitlement identifiers', () => {
  const parsed = parsePublicRoom({ ...publicRoom, accountId: 'private-account', studio: {
    ...publicRoom.studio, accountId: 'private-account', studio: { ...publicRoom.studio.studio, slots: ['private-entitlement'] },
    items: [{ ...publicRoom.studio.items[0], entitlementId: 'private-entitlement' }],
  } });
  assert.equal('accountId' in parsed, false);
  assert.equal('accountId' in parsed.studio, false);
  assert.equal('slots' in parsed.studio.studio, false);
  assert.equal('entitlementId' in parsed.studio.items[0], false);
  assert.deepEqual(parsed.stamps, publicRoom.stamps);
  assert.throws(() => parsePublicRoom({ ...publicRoom, stamps: [{ ...publicRoom.stamps[0], kind: 'TEXT' }] }));
});

test('settings and room visit follow server response and tolerate an empty random pool', async () => {
  const calls: string[] = [];
  const client = createRoomApiClient({ apiUrl: 'https://api.test/', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/me/room-publication')) return Response.json({ visible: true, roomId: 'mine' });
      if (url.includes('/rooms/random')) return Response.json(null);
      if (url.endsWith('/visits')) return Response.json({ roomId: 'room-1', creditedMileage: 0, visitsToday: 1 });
      throw new Error('unexpected request');
    },
  });
  assert.deepEqual(await client.getSettings(), { visible: true, roomId: 'mine', visibility: 'NEIGHBORS' });
  assert.equal(await client.randomRoom('previous'), null);
  assert.deepEqual(await client.visit('room-1'), { roomId: 'room-1', creditedMileage: 0, visitsToday: 1 });
  assert.ok(calls.some((call) => call.endsWith('/rooms/random?excludeRoomId=previous')));
  assert.throws(() => parseRoomSettings({ visible: 'yes', roomId: null }));
});

test('room scope and common merchants are parsed without private visit details', () => {
  const parsed = parsePublicRoom({ ...publicRoom, visibility: 'NEIGHBORS', sharedMerchants: [
    { merchantId: 'merchant-1', merchantName: '가게', visitedAt: 'private' },
  ], visitorCount: 3, hasVisited: true, returnVisitAvailable: false });
  assert.deepEqual(parsed.sharedMerchants, [{ merchantId: 'merchant-1', merchantName: '가게' }]);
  assert.equal(parsed.visitorCount, 3);
  assert.deepEqual(parseRoomSettings({ visible: false, roomId: null, visibility: 'PRIVATE' }).visibility, 'PRIVATE');
  assert.throws(() => parseRoomSettings({ visible: true, roomId: 'mine', visibility: 'PUBLIC' }));
});

test('visitor list exposes returnable room only when server provides it', () => {
  const visitors = parseRoomVisitors({ visitors: [
    { nickname: '이웃', visits: 2, roomId: 'public-room', canReturn: true, visitedAt: 'private' },
    { nickname: '친구', visits: 1, roomId: null, canReturn: false },
  ] });
  assert.deepEqual(visitors[0], { nickname: '이웃', visits: 2, roomId: 'public-room', canReturn: true });
  assert.equal(visitors[1]?.roomId, null);
  assert.throws(() => parseRoomVisitors({ visitors: [{ nickname: '이웃', visits: 1, roomId: 42, canReturn: true }] }));
});

test('room API preserves consent and private-room status for recovery', async () => {
  const client = createRoomApiClient({ apiUrl: 'https://api.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ code: 'CONSENT_REQUIRED' }, { status: 403 }),
  });
  await assert.rejects(() => client.randomRoom(), (error) => error instanceof RoomApiError
    && error.status === 403 && error.code === 'CONSENT_REQUIRED'
    && roomErrorMessage(error) === '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.');
  assert.match(roomErrorMessage(new RoomApiError(404, 'ROOM_NOT_FOUND')), /공개되어 있지/);
  assert.match(roomErrorMessage(new RoomApiError(409, 'ROOM_STAMP_LIMIT')), /오늘 이미/);
  assert.match(roomErrorMessage(new RoomApiError(404, 'FRIEND_NEIGHBOR_NOT_FOUND')), /더 이상 이웃/);
  assert.match(roomErrorMessage(new RoomApiError(409, 'FRIEND_LIMIT')), /친구 수가 가득/);
});

test('neighbor friendship sends only the room ID and accepts created or existing friendship', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const friend = { friendshipId: '11111111-1111-4111-8111-111111111111', nickname: '이웃', badges: { earned: 0, total: 9 },
    medals: [{ key: 'explorer', tier: 0 }, { key: 'regular', tier: 0 }, { key: 'steady', tier: 0 }], stamps: [], rank: 1 };
  const client = createRoomApiClient({ apiUrl: 'https://api.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ friend, created: calls.length === 1 }, { status: calls.length === 1 ? 201 : 200 });
    },
  });
  assert.equal((await client.addFriend('room/1')).created, true);
  assert.equal((await client.addFriend('room/1')).created, false);
  assert.deepEqual(calls, [{ url: 'https://api.test/rooms/room%2F1/friendship', body: {} },
    { url: 'https://api.test/rooms/room%2F1/friendship', body: {} }]);
});

test('guestbook supports optional Unicode text with the existing reaction and hides private author IDs', async () => {
  const stamp = { ...publicRoom.stamps[0], message: '좋은 방이에요 😀', accountId: 'private-account' };
  const calls: unknown[] = [];
  const client = createRoomApiClient({ apiUrl: 'https://api.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_input, init) => { calls.push(JSON.parse(String(init?.body))); return Response.json(stamp); },
  });
  assert.deepEqual(await client.stamp('room-1', 'COZY', '  좋은 방이에요 😀  '), parseRoomStamp(stamp));
  assert.deepEqual(calls, [{ kind: 'COZY', message: '좋은 방이에요 😀' }]);
  assert.equal('accountId' in parseRoomStamp(stamp), false);
  assert.equal(normalizeRoomMessage('   '), undefined);
  assert.equal(Array.from(normalizeRoomMessage('😀'.repeat(120)) ?? '').length, 120);
  for (const invalid of ['😀'.repeat(121), '줄\n바꿈', '숨김\u200b문자', '\ud800']) {
    assert.throws(() => normalizeRoomMessage(invalid), (error) => error instanceof RoomApiError && error.code === 'ROOM_MESSAGE_INVALID');
  }
  assert.match(roomErrorMessage(new RoomApiError(400, 'ROOM_MESSAGE_INVALID')), /120자/);
});
