import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoomApiClient, parsePublicRoom, parseRoomSettings, roomErrorMessage, RoomApiError } from './room-api';

const publicRoom = { roomId: 'room-1', mine: false, studio: {
  nickname: '방 주인', studio: { theme: 'daylight', layout: 'shelf', accent: 'mint', goal: null },
  items: [{ merchantId: 'merchant-1', merchantName: '가게', campaignTitle: '수집', displayName: '코인' }], avatar: null,
}, stamps: [{ id: 'stamp-1', kind: 'COZY', createdAt: '2026-10-07T12:00:00.000Z', mine: true }] };

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
  assert.deepEqual(await client.getSettings(), { visible: true, roomId: 'mine' });
  assert.equal(await client.randomRoom('previous'), null);
  assert.deepEqual(await client.visit('room-1'), { roomId: 'room-1', creditedMileage: 0, visitsToday: 1 });
  assert.ok(calls.some((call) => call.endsWith('/rooms/random?excludeRoomId=previous')));
  assert.throws(() => parseRoomSettings({ visible: 'yes', roomId: null }));
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
});
