import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { CoinEconomyError, type CoinEconomyService } from './coin-economy.js';
import { RoomCommunityError, type RoomCommunityService } from './room-community.js';
import { GradeDrawError, type GradeDrawService } from './grade-draw.js';
import { FriendError, type FriendErrorCode, type FriendService } from './friends.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

// Run the byte-for-byte origin/main mobile parser from the mobile package so its existing aliases resolve.
function parseInstalledResponses(settings: unknown[], rooms: unknown[]): { settings: string[]; rooms: string[] } {
  const cwd = new URL('../../mobile/', import.meta.url);
  const source = readFileSync(new URL('./src/studio/room-api.legacy.ts', cwd));
  assert.equal(createHash('sha256').update(source).digest('hex'), '4af607903447b2db96a48c48d94ff7d9700376a813ae8283fe910f533ca9f4cb');
  const script = `const { parseRoomSettings, parsePublicRoom } = require('./src/studio/room-api.legacy.ts');
    let data = ''; process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => { const input = JSON.parse(data); process.stdout.write(JSON.stringify({
      settings: input.settings.map(value => parseRoomSettings(value).visibility),
      rooms: input.rooms.map(value => parsePublicRoom(value).visibility) })); });`;
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '-e', script], {
    cwd, input: JSON.stringify({ settings, rooms }), encoding: 'utf8', timeout: 15000,
  })) as { settings: string[]; rooms: string[] };
}

async function request(server: Server, method: string, url: string, accountId?: string, body?: unknown, headers: Record<string, string> = {}) {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method; incoming.url = url; incoming.httpVersion = '1.0';
  incoming.headers = { 'content-type': 'application/json', ...(accountId ? { 'x-account-id': accountId } : {}), ...headers };
  if (body !== undefined) incoming.push(JSON.stringify(body));
  incoming.push(null);
  const response = new ServerResponse(incoming), transport = new PassThrough();
  const chunks: Buffer[] = [];
  transport.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.assignSocket(transport as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve); response.once('error', reject);
    server.emit('request', incoming, response);
  });
  const payload = Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]!;
  return { status: response.statusCode, body: payload ? JSON.parse(payload) : undefined };
}

function fixture(configure?: (args: Parameters<typeof createApiServer>) => void) {
  const calls: unknown[] = [];
  const capture = async (input: unknown) => { calls.push(input); return { replayed: true }; };
  const coins = { getShop: capture, getCollection: capture, purchase: capture, useTicket: capture,
    claimSeries: capture, publishPool: capture, publishSeries: capture,
    grantRerollTicket: capture, useRerollTicket: capture } as unknown as CoinEconomyService;
  const rooms = { getSettings: capture, setVisibility: capture, randomRoom: capture, getRoom: capture,
    visit: capture, stamp: capture, removeStamp: capture, reportStamp: capture, blockRoom: capture,
    neighbors: capture, visitors: capture, getGuestbook: capture, getMyGuestbook: capture,
    postGuestbook: capture, readGuestbook: capture, getGuestbookAuthor: capture,
    removeGuestbook: capture, reportGuestbook: capture, listGuestbookReports: capture, moderateGuestbook: capture } as unknown as RoomCommunityService;
  const gradeDraw = { getShop: capture, draw: capture } as unknown as GradeDrawService;
  const consent: ConsentService = { appSource: 'ANDROID', status: async id => ({ required: id === 'old',
    termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }),
    record: async () => { throw new Error('implicit consent'); } };
  const challenge = new WalletChallengeService({ store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 300000,
    nonce: () => 'coinroomnonce123', challengeId: () => 'coin-room-test' });
  const args: Parameters<typeof createApiServer> = [challenge, developmentHeaderAccountResolver];
  args[26] = consent;
  args[39] = { coinEconomy: coins, roomCommunity: rooms, gradeDraw,
    furniture: { get: capture, purchase: capture } } as unknown as NonNullable<typeof args[39]>;
  configure?.(args);
  return { server: createApiServer(...args), calls, coins, rooms, gradeDraw };
}

const id = '00000000-0000-4000-8000-000000000001';
const routes = [
  ['GET', '/shop/draw-pools', undefined], ['POST', '/shop/draws', { grade: 'BRONZE', requestId: 'one', expectedPoolVersion: 'a'.repeat(64) }],
  ['GET', '/coin-shop', undefined], ['POST', '/coin-shop/purchases', { poolId: id, requestId: 'purchase-1' }],
  ['POST', `/coin-tickets/${id}/use`, {}], ['GET', '/me/coins', undefined], ['POST', `/coin-series/${id}/claim`, {}],
  ['POST', `/coin-reroll-tickets/${id}/use`, { poolId: id, sourceKind: 'VISIT', sourceId: id, requestId: 'reroll-1' }],
  ['GET', '/me/room-publication', undefined], ['PUT', '/me/room-publication', { visible: true }],
  ['PUT', '/me/room-publication', { visibility: 'FRIENDS' }],
  ['PUT', '/me/room-publication', { visibility: 'PUBLIC' }],
  ['GET', '/rooms/neighbors', undefined], ['GET', '/me/room-visitors', undefined],
  ['GET', '/me/furniture', undefined], ['POST', '/me/furniture/purchases', { itemId: id, requestId: 'furniture-1' }],
  ['GET', '/rooms/random', undefined], ['GET', `/rooms/${id}`, undefined], ['POST', `/rooms/${id}/visits`, {}],
  ['POST', `/rooms/${id}/stamps`, { kind: 'COZY' }], ['DELETE', `/room-stamps/${id}`, undefined],
  ['POST', `/room-stamps/${id}/reports`, {}], ['POST', `/rooms/${id}/block`, {}],
  ['POST', `/rooms/${id}/friendship`, {}],
  ['GET', `/rooms/${id}/guestbook`, undefined], ['GET', '/me/room-guestbook', undefined],
  ['POST', `/rooms/${id}/guestbook`, { requestId: 'one', message: '좋은 방' }],
  ['POST', '/me/room-guestbook/read', { entryIds: [id] }], ['GET', `/room-guestbook/${id}/author`, undefined],
  ['POST', `/room-guestbook/${id}/friendship`, {}], ['POST', `/room-guestbook/${id}/reports`, {}],
  ['DELETE', `/room-guestbook/${id}`, undefined],
] as const;

test('guestbook routes use authenticated identity, explicit read ids and opaque author entry references', async () => {
  const f = fixture(args => {
    args[21] = { addGuestbookAuthor: async () => ({ friend: { friendshipId: id }, created: true }) } as unknown as FriendService;
  });
  assert.equal((await request(f.server,'POST',`/rooms/${id}/guestbook`,'customer',{ requestId: 'one',message: '좋아요' })).status,200);
  assert.deepEqual(f.calls.at(-1),{ accountId: 'customer',roomId: id,requestId: 'one',message: '좋아요' });
  assert.equal((await request(f.server,'GET',`/rooms/${id}/guestbook?cursor=opaque`,'customer')).status,200);
  assert.deepEqual(f.calls.at(-1),{ accountId: 'customer',roomId: id,cursor: 'opaque' });
  assert.equal((await request(f.server,'POST','/me/room-guestbook/read','customer',{ entryIds: [id] })).status,200);
  assert.deepEqual(f.calls.at(-1),{ accountId: 'customer',entryIds: [id] });
  assert.equal((await request(f.server,'GET',`/room-guestbook/${id}/author`,'customer')).status,200);
  assert.deepEqual(f.calls.at(-1),{ accountId: 'customer',entryId: id });
  assert.equal((await request(f.server,'POST',`/room-guestbook/${id}/friendship`,'customer',{})).status,201);
  assert.equal((await request(f.server,'DELETE',`/room-guestbook/${id}`,'customer')).status,204);
  assert.equal((await request(f.server,'DELETE',`/room-guestbook/${id}`,'customer',{ unexpected: true })).status,400);
  for (const body of [{ requestId: 'x',message: 'hello',amount: 5 },{ requestId: 'x',message: 'hello',accountId: 'other' }])
    assert.equal((await request(f.server,'POST',`/rooms/${id}/guestbook`,'customer',body)).status,400);
  assert.equal((await request(f.server,'POST','/me/room-guestbook/read','customer',{ entryIds: [3] })).status,400);
  assert.equal((await request(f.server,'GET','/me/room-guestbook?cursor=a&cursor=b','customer')).status,400);
  f.rooms.postGuestbook = async () => { throw new RoomCommunityError('ROOM_REQUEST_CONFLICT'); };
  assert.equal((await request(f.server,'POST',`/rooms/${id}/guestbook`,'customer',{ requestId: 'one',message: 'changed' })).status,409);
  f.rooms.getGuestbookAuthor = async () => { throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND'); };
  assert.equal((await request(f.server,'GET',`/room-guestbook/${id}/author`,'customer')).status,404);
});

test('guestbook safety errors retain actionable HTTP codes', async () => {
  let friendCode: FriendErrorCode = 'FRIEND_GUESTBOOK_NOT_FOUND';
  const f = fixture(args => {
    args[21] = { addGuestbookAuthor: async () => { throw new FriendError(friendCode); } } as unknown as FriendService;
  });
  const friendship = `/room-guestbook/${id}/friendship`;
  assert.deepEqual(await request(f.server, 'POST', friendship, 'customer', {}),
    { status: 404, body: { code: friendCode } });
  friendCode = 'FRIEND_GUESTBOOK_DAILY_LIMIT';
  assert.deepEqual(await request(f.server, 'POST', friendship, 'customer', {}),
    { status: 429, body: { code: friendCode } });
  f.rooms.postGuestbook = async () => { throw new RoomCommunityError('ROOM_GUESTBOOK_DAILY_LIMIT'); };
  assert.deepEqual(await request(f.server, 'POST', `/rooms/${id}/guestbook`, 'customer', { requestId: 'one', message: '안녕' }),
    { status: 429, body: { code: 'ROOM_GUESTBOOK_DAILY_LIMIT' } });
  f.rooms.getGuestbook = async () => { throw new RoomCommunityError('ROOM_REQUEST_INVALID'); };
  assert.deepEqual(await request(f.server, 'GET', `/rooms/${id}/guestbook?cursor=bad`, 'customer'),
    { status: 400, body: { code: 'ROOM_REQUEST_INVALID' } });
});

test('text guestbook moderation requires the existing admin session and CSRF boundary', async () => {
  const f = fixture(args => {
    args[14] = { resolveSession: async () => 'verified-admin' } as unknown as NonNullable<typeof args[14]>;
    args[17] = { isAdmin: async () => true } as unknown as NonNullable<typeof args[17]>;
  });
  const headers = { host: 'masscom.kr',origin: 'https://masscom.kr',cookie: 'web_session=test-cookie' };
  const path = `/api/web/admin/room-guestbook/${id}/hide`;
  assert.equal((await request(f.server,'POST',path,undefined,{}, { ...headers,origin: 'https://foreign.example' })).status,403);
  assert.equal((await request(f.server,'POST',path,undefined,{ actorAccountId: 'forged' },headers)).status,400);
  assert.deepEqual(f.calls,[]);
  assert.equal((await request(f.server,'POST',path,undefined,{},headers)).status,204);
  assert.deepEqual(f.calls.at(-1),{ actorAccountId: 'verified-admin',entryId: id });
  assert.equal((await request(f.server,'GET','/api/web/admin/room-guestbook-reports',undefined,undefined,headers)).status,200);
  assert.equal(f.calls.at(-1),'verified-admin');
});

test('coin and community routes require authenticated current consent before reading or writing', async () => {
  const f = fixture();
  for (const [method, path, body] of routes) {
    assert.equal((await request(f.server, method, path, undefined, body)).status, 401, path);
    assert.equal((await request(f.server, method, path, 'old', body)).status, 403, path);
  }
  assert.deepEqual(f.calls, []);
});

test('purchase and draw use authenticated account and stable replay keys', async () => {
  const f = fixture();
  assert.equal((await request(f.server, 'POST', '/coin-shop/purchases', 'customer', { poolId: id, requestId: 'lost-response' })).status, 200);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', poolId: id, requestId: 'lost-response' });
  assert.equal((await request(f.server, 'POST', `/coin-tickets/${id}/use`, 'customer', {})).status, 200);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', ticketId: id });
  assert.equal((await request(f.server, 'POST', `/coin-series/${id}/claim`, 'customer', {})).status, 200);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', seriesId: id });
  assert.equal((await request(f.server, 'POST', `/coin-reroll-tickets/${id}/use`, 'customer',
    { poolId: id, sourceKind: 'VISIT', sourceId: id, requestId: 'reroll-after-timeout' })).status, 200);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', ticketId: id, poolId: id,
    sourceKind: 'VISIT', sourceId: id, requestId: 'reroll-after-timeout' });
});

test('extra account, weights, reward amounts and public text are rejected at HTTP boundary', async () => {
  const f = fixture();
  const invalid = [
    ['/coin-shop/purchases', { poolId: id, requestId: 'x', accountId: 'victim' }],
    [`/coin-reroll-tickets/${id}/use`, { poolId: id, sourceKind: 'VISIT', sourceId: id,
      requestId: 'x', accountId: 'victim' }],
    [`/coin-tickets/${id}/use`, { weight: 999 }], [`/coin-series/${id}/claim`, { tier: 'PRISM' }],
    [`/rooms/${id}/visits`, { mileage: 1000 }], [`/rooms/${id}/stamps`, { kind: 'COZY', text: 'free text' }],
  ] as const;
  for (const [path, body] of invalid) assert.equal((await request(f.server, 'POST', path, 'customer', body)).status, 400, path);
  assert.equal((await request(f.server, 'PUT', '/me/room-publication', 'customer', { visible: 'true' })).status, 400);
  assert.deepEqual(f.calls, []);
});

test('public sharing can be withdrawn before accepting updated consent and read routes reject writes', async () => {
  const f = fixture();
  assert.equal((await request(f.server, 'PUT', '/me/room-publication', 'old', { visible: false })).status, 200);
  assert.deepEqual(f.calls.at(-1), { accountId: 'old', visible: false });
  for (const path of ['/coin-shop', '/me/coins']) assert.equal((await request(f.server, 'POST', path, 'customer', {})).status, 405);
});

test('community route preserves opaque room and stamp identifiers and returns empty random honestly', async () => {
  const f = fixture();
  f.rooms.randomRoom = async input => { f.calls.push(input); return null; };
  assert.deepEqual((await request(f.server, 'GET', `/rooms/random?excludeRoomId=${id}`, 'customer')).body, null);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', excludeRoomId: id, supportsPublic: false });
  assert.equal((await request(f.server, 'POST', `/rooms/${id}/stamps`, 'customer',
    { kind: 'COOL', message: '다시 올게요' })).status, 201);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', roomId: id, kind: 'COOL', message: '다시 올게요' });
  assert.equal((await request(f.server, 'DELETE', `/room-stamps/${id}`, 'customer')).status, 204);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', stampId: id });
  assert.equal((await request(f.server, 'DELETE', `/room-stamps/${id}`, 'customer', { unexpected: true })).status, 400);
});

test('installed room parsers receive legacy visibility while v2 clients receive PUBLIC', async () => {
  const f = fixture();
  const settings = { visible: true, roomId: id, visibility: 'PUBLIC' } as const;
  const room = { roomId: id, mine: false, visibility: 'PUBLIC', studio: {
    nickname: '방 주인', studio: { theme: 'daylight', layout: 'shelf', accent: 'mint', goal: null },
    items: [], avatar: null,
  }, stamps: [], sharedMerchants: [], visitorCount: 0, hasVisited: false,
  returnVisitAvailable: false, friendshipId: null } as const;
  f.rooms.getSettings = async () => settings;
  f.rooms.setVisibility = async () => settings;
  f.rooms.getRoom = async () => room as never;
  f.rooms.neighbors = async () => [room as never];
  f.rooms.randomRoom = async input => { f.calls.push(input); return input.supportsPublic ? room as never : null; };
  const legacySettings = (await request(f.server, 'GET', '/me/room-publication', 'customer')).body;
  const legacyUpdate = (await request(f.server, 'PUT', '/me/room-publication', 'customer', { visibility: 'PUBLIC' })).body;
  const legacyRoom = (await request(f.server, 'GET', `/rooms/${id}`, 'customer')).body;
  const legacyNeighbors = (await request(f.server, 'GET', '/rooms/neighbors', 'customer')).body;
  assert.deepEqual(parseInstalledResponses([legacySettings, legacyUpdate], [legacyRoom, legacyNeighbors.rooms[0]]),
    { settings: ['NEIGHBORS', 'NEIGHBORS'], rooms: ['NEIGHBORS', 'NEIGHBORS'] });
  assert.equal((await request(f.server, 'GET', '/rooms/random', 'customer')).body, null);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', supportsPublic: false });

  const v2 = { 'x-masscom-room-visibility': 'v2' };
  assert.equal((await request(f.server, 'GET', '/me/room-publication', 'customer', undefined, v2)).body.visibility, 'PUBLIC');
  assert.equal((await request(f.server, 'GET', `/rooms/${id}`, 'customer', undefined, v2)).body.visibility, 'PUBLIC');
  assert.equal((await request(f.server, 'GET', '/rooms/random', 'customer', undefined, v2)).body.visibility, 'PUBLIC');
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', supportsPublic: true });
});

test('neighbor friendship route accepts only a separate empty-body action and maps replay or revoked access', async () => {
  const calls: unknown[] = [];
  let created = true;
  let denied = false;
  const f = fixture(args => {
    args[21] = { addNeighbor: async (input: { accountId: string; roomId: string }) => {
      calls.push(input);
      if (denied) throw new FriendError('FRIEND_NEIGHBOR_NOT_FOUND');
      return { friend: { friendshipId: id }, created };
    } } as unknown as FriendService;
  });
  const path = `/rooms/${id}/friendship`;
  assert.equal((await request(f.server, 'POST', path, 'customer', { accountId: 'other' })).status, 400);
  assert.deepEqual(calls, []);
  assert.equal((await request(f.server, 'POST', path, 'customer', {})).status, 201);
  assert.deepEqual(calls.at(-1), { accountId: 'customer', roomId: id });
  created = false;
  assert.equal((await request(f.server, 'POST', path, 'customer', {})).status, 200);
  denied = true;
  assert.deepEqual(await request(f.server, 'POST', path, 'customer', {}),
    { status: 404, body: { code: 'FRIEND_NEIGHBOR_NOT_FOUND' } });
});

test('expired ticket and hidden room failures keep actionable status codes', async () => {
  const f = fixture();
  f.coins.useTicket = async () => { throw new CoinEconomyError('COIN_TICKET_EXPIRED'); };
  f.rooms.getRoom = async () => { throw new RoomCommunityError('ROOM_NOT_FOUND'); };
  assert.deepEqual(await request(f.server, 'POST', `/coin-tickets/${id}/use`, 'customer', {}),
    { status: 409, body: { code: 'COIN_TICKET_EXPIRED' } });
  assert.equal((await request(f.server, 'GET', `/rooms/${id}`, 'customer')).status, 404);
});

test('coin publication uses existing web admin session and CSRF checks without accepting a caller-supplied actor', async () => {
  const f = fixture(args => {
    args[14] = { resolveSession: async () => 'verified-admin' } as unknown as NonNullable<typeof args[14]>;
    args[17] = { isAdmin: async () => true } as unknown as NonNullable<typeof args[17]>;
  });
  const headers = { host: 'masscom.kr', origin: 'https://masscom.kr', cookie: 'web_session=test-cookie' };
  const path = '/api/web/admin/coin-pools';
  const body = { merchantId: 'store', eventName: 'event', grade: 'SILVER', price: 200,
    purchaseStartsAt: '2026-10-07', purchaseEndsAt: '2026-10-08', useExpiresAt: '2026-10-09',
    perAccountLimit: 2, issuanceCap: 10, entries: [] };
  assert.equal((await request(f.server, 'POST', path, undefined, body, { ...headers, origin: 'https://foreign.example' })).status, 403);
  assert.equal((await request(f.server, 'POST', path, undefined, { ...body, actorAccountId: 'forged' }, headers)).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal((await request(f.server, 'POST', path, undefined, body, headers)).status, 201);
  assert.deepEqual(f.calls.at(-1), { ...body, actorAccountId: 'verified-admin' });
  const grant = '/api/web/admin/coin-reroll-tickets/grant';
  const grantBody = { accountId: 'customer', grade: 'SILVER', requestId: 'approved-grant' };
  assert.equal((await request(f.server, 'POST', grant, undefined, { ...grantBody, actorAccountId: 'forged' }, headers)).status, 400);
  assert.equal((await request(f.server, 'POST', grant, undefined, grantBody, headers)).status, 200);
  assert.deepEqual(f.calls.at(-1), { ...grantBody, actorAccountId: 'verified-admin' });
});

test('grade draw rejects forced rewards and forwards a stable pool and request for one replay', async () => {
  const f = fixture();
  const body = { grade: 'SILVER', requestId: 'lost-grade-response', expectedPoolVersion: 'a'.repeat(64) };
  assert.equal((await request(f.server, 'GET', '/shop/draw-pools', 'customer')).status, 200);
  f.calls.length = 0;
  assert.equal((await request(f.server, 'POST', '/shop/draws', 'customer', { ...body, kind: 'COIN' })).status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal((await request(f.server, 'POST', '/shop/draws', 'customer', body)).status, 200);
  assert.deepEqual(f.calls.at(-1), { ...body, accountId: 'customer' });
  f.gradeDraw.draw = async () => { throw new GradeDrawError('DRAW_STATE_CHANGED'); };
  assert.deepEqual(await request(f.server, 'POST', '/shop/draws', 'customer', body),
    { status: 409, body: { code: 'DRAW_STATE_CHANGED' } });
});
