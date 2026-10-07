import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { CoinEconomyError, type CoinEconomyService } from './coin-economy.js';
import { RoomCommunityError, type RoomCommunityService } from './room-community.js';
import { GradeDrawError, type GradeDrawService } from './grade-draw.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

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
    claimSeries: capture, publishPool: capture, publishSeries: capture } as unknown as CoinEconomyService;
  const rooms = { getSettings: capture, setVisibility: capture, randomRoom: capture, getRoom: capture,
    visit: capture, stamp: capture, removeStamp: capture, reportStamp: capture, blockRoom: capture } as unknown as RoomCommunityService;
  const gradeDraw = { getShop: capture, draw: capture } as unknown as GradeDrawService;
  const consent: ConsentService = { appSource: 'ANDROID', status: async id => ({ required: id === 'old',
    termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }),
    record: async () => { throw new Error('implicit consent'); } };
  const challenge = new WalletChallengeService({ store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 300000,
    nonce: () => 'coinroomnonce123', challengeId: () => 'coin-room-test' });
  const args: Parameters<typeof createApiServer> = [challenge, developmentHeaderAccountResolver];
  args[26] = consent;
  args[39] = { coinEconomy: coins, roomCommunity: rooms, gradeDraw } as NonNullable<typeof args[39]>;
  configure?.(args);
  return { server: createApiServer(...args), calls, coins, rooms, gradeDraw };
}

const id = '00000000-0000-4000-8000-000000000001';
const routes = [
  ['GET', '/shop/draw-pools', undefined], ['POST', '/shop/draws', { grade: 'BRONZE', requestId: 'one', expectedPoolVersion: 'a'.repeat(64) }],
  ['GET', '/coin-shop', undefined], ['POST', '/coin-shop/purchases', { poolId: id, requestId: 'purchase-1' }],
  ['POST', `/coin-tickets/${id}/use`, {}], ['GET', '/me/coins', undefined], ['POST', `/coin-series/${id}/claim`, {}],
  ['GET', '/me/room-publication', undefined], ['PUT', '/me/room-publication', { visible: true }],
  ['GET', '/rooms/random', undefined], ['GET', `/rooms/${id}`, undefined], ['POST', `/rooms/${id}/visits`, {}],
  ['POST', `/rooms/${id}/stamps`, { kind: 'COZY' }], ['DELETE', `/room-stamps/${id}`, {}],
  ['POST', `/room-stamps/${id}/reports`, {}], ['POST', `/rooms/${id}/block`, {}],
] as const;

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
});

test('extra account, weights, reward amounts and public text are rejected at HTTP boundary', async () => {
  const f = fixture();
  const invalid = [
    ['/coin-shop/purchases', { poolId: id, requestId: 'x', accountId: 'victim' }],
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
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', excludeRoomId: id });
  assert.equal((await request(f.server, 'POST', `/rooms/${id}/stamps`, 'customer', { kind: 'COOL' })).status, 201);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', roomId: id, kind: 'COOL' });
  assert.equal((await request(f.server, 'DELETE', `/room-stamps/${id}`, 'customer', {})).status, 204);
  assert.deepEqual(f.calls.at(-1), { accountId: 'customer', stampId: id });
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
