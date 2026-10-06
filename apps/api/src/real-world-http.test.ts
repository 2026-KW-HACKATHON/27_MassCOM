import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { handleRealWorldHttp } from './real-world-http.js';
import { RealWorldError } from './real-world-contract.js';
import type { PostgresRealWorldService } from './postgres/real-world.js';
import type { TmapProvider } from './tmap-provider.js';
import type { MapProvider } from './map-provider.js';
import { realWorldAdminCheck } from './server.js';
import type { PoolClient } from 'pg';
import type { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';

test('public detail preserves the versioned response and never records a duplicate view', async () => {
  let detailCalls = 0, events = 0;
  const svc = { merchant: async (id: string) => { detailCalls++; return { id, name: '가게' }; },
    recordEvent: async () => { events++; } } as unknown as PostgresRealWorldService;
  const server = createServer(async (request, response) => {
    try {
      await handleRealWorldHttp({ request, response, path: new URL(request.url!, 'http://localhost').pathname,
        realWorld: svc, resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
        readBody: async () => ({}), decode: decodeURIComponent,
        send: (status, value) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)),
        consumeEvent: () => {}, });
    } catch (error) {
      response.writeHead(error instanceof RealWorldError ? error.status : 500).end();
    }
  });
  server.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); assert(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/discovery/merchants/m1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.schemaVersion, 1); assert.equal(body.merchant.id, 'm1');
    assert.equal(detailCalls, 1); assert.equal(events, 0);
  } finally { server.close(); await once(server, 'close'); }
});

test('photo upload checks web identity before reading large body', async () => {
  let read = false;
  await assert.rejects(handleRealWorldHttp({ request: { method: 'POST' } as never, response: {} as never,
    path: '/api/web/v1/merchant/merchants/m1/photos',
    realWorld: {} as PostgresRealWorldService, resolveAccountId: async () => 'account',
    resolveWebAccountId: async () => { throw new RealWorldError('WEB_DENIED', 401); },
    readBody: async () => { read = true; return {}; }, decode: decodeURIComponent,
    send: () => {}, consumeEvent: () => {}, }), (error: unknown) => error instanceof RealWorldError && error.status === 401);
  assert.equal(read, false);
});

test('event body rejects location and other extra fields before storage', async () => {
  let stored = false;
  await assert.rejects(handleRealWorldHttp({ request: { method: 'POST' } as never, response: {} as never,
    path: '/v1/discovery/events', realWorld: { recordEvent: async () => { stored = true; } } as unknown as PostgresRealWorldService,
    resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
    readBody: async () => ({ eventId: 'bad', merchantId: 'm1', event: 'MAP_SELECT', source: 'map', latitude: 37 }),
    decode: decodeURIComponent, send: () => {}, consumeEvent: () => {}, }),
  (error: unknown) => error instanceof RealWorldError && error.code === 'INVALID_REQUEST');
  assert.equal(stored, false);
});

test('walking route uses pedestrian legs and dwell to evaluate arrival times', async () => {
  const destinations: number[] = [];
  const svc = { merchant: async (id: string) => ({ id, profileVersion: 2,
    positionBasis: 'OWNED', position: { latitude: 37, longitude: id === 'a' ? 127.01 : 127.02 },
    location: { source: 'OWNER_DECLARED', entrance: null }, schedule: null, todayOverride: null, campaign: null,
  }) } as unknown as PostgresRealWorldService;
  const tmap = { configured: () => true, walk: async (_origin: unknown, destination: { longitude: number }) => {
    destinations.push(destination.longitude);
    return { mode: 'WALK', provider: 'TMAP', travelSeconds: 60, travelMeters: 100,
      geometry: { type: 'MultiLineString', coordinates: [[[127, 37], [destination.longitude, 37]]] },
      fetchedAt: '2026-10-06T00:00:00Z', expiresAt: '2026-10-06T01:00:00Z', attribution: 'TMAP' };
  } } as unknown as TmapProvider;
  let payload: any;
  await handleRealWorldHttp({ request: { method: 'POST' } as never, response: {} as never,
    path: '/v1/discovery/walking-routes', realWorld: svc, tmap,
    resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
    readBody: async () => ({ origin: { latitude: 37, longitude: 127 }, merchantIds: ['a', 'b'],
      departureAt: '2026-10-06T00:00:00Z', dwellMinutes: [10, 5] }), decode: decodeURIComponent,
    send: (_status, value) => { payload = value; }, consumeEvent: () => {}, });
  assert.deepEqual(destinations, [127.01, 127.02]);
  assert.equal(payload.mode, 'WALK'); assert.equal(payload.travelMeters, 200);
  assert.equal(payload.travelSeconds, 120); assert.equal(payload.dwellSeconds, 900);
  assert.equal(payload.stops[0].arrivalAt, '2026-10-06T00:01:00.000Z');
  assert.equal(payload.stops[1].arrivalAt, '2026-10-06T00:12:00.000Z');
  assert.deepEqual(payload.stops[0].warnings, ['HOURS_UNKNOWN']);
});

test('location candidates check ownership before spending a map request', async () => {
  let geocoded = false;
  const realWorld = { profile: async () => { throw new RealWorldError('MERCHANT_FORBIDDEN', 403); } } as unknown as PostgresRealWorldService;
  const tmap = { configured: () => true, geocode: async () => { geocoded = true; return []; } } as unknown as TmapProvider;
  await assert.rejects(handleRealWorldHttp({ request: { method: 'POST' } as never, response: {} as never,
    path: '/api/web/v1/merchant/merchants/m1/location-candidates', realWorld, tmap,
    resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
    readBody: async () => ({ address: '서울' }), decode: decodeURIComponent,
    send: () => {}, consumeEvent: () => {}, }),
  (error: unknown) => error instanceof RealWorldError && error.status === 403);
  assert.equal(geocoded, false);
});

test('startup admin callback uses the supplied transaction client and fails closed', async () => {
  const calls: string[] = [];
  const client = { query: async () => { calls.push('role'); return { rowCount: 1 }; } } as unknown as PoolClient;
  let expected = client;
  const lifecycle = { assertActive: async (sameClient: PoolClient, accountId: string) => {
    assert.equal(sameClient, expected); assert.equal(accountId, 'account'); calls.push('active');
  } } as PostgresAccountLifecycle;
  const check = realWorldAdminCheck(lifecycle);
  assert.equal(await check(client, 'account'), true);
  assert.deepEqual(calls, ['active', 'role']);
  const missing = { query: async () => ({ rowCount: 0 }) } as unknown as PoolClient;
  expected = missing;
  assert.equal(await check(missing, 'account'), false);
});

test('client-shaped map search and walk reach service and pedestrian provider over HTTP', async () => {
  let seenOrigin: unknown, walked = 0, quota = 0;
  const schedule = { timezone: 'Asia/Seoul', verifiedAt: null, exceptions: [],
    weekly: [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, periods: [{ startMinute: 0, endMinute: 1439, lastOrderMinute: 1 }] })) };
  const svc = { search: async (query: { origin: unknown }) => { seenOrigin = query.origin; return {
    schemaVersion: 1, asOf: '2026-10-06T00:00:00Z', merchants: [], clusters: [], nextCursor: null, unlocatedCount: 0,
  }; }, merchant: async () => ({ id: 'm1', profileVersion: 2, positionBasis: 'OWNED',
    position: { latitude: 37.6, longitude: 127.1 }, location: { source: 'OWNER_DECLARED', entrance: null },
    schedule, todayOverride: null, campaign: null }) } as unknown as PostgresRealWorldService;
  const tmap = { configured: () => true, walk: async () => { walked++; return {
    mode: 'WALK', provider: 'TMAP', travelSeconds: 60, travelMeters: 100,
    geometry: { type: 'MultiLineString', coordinates: [[[127, 37.6], [127.1, 37.6]]] },
    fetchedAt: '2026-10-06T00:00:00Z', expiresAt: '2026-10-06T01:00:00Z', attribution: 'TMAP',
  }; } } as unknown as TmapProvider;
  const server = createServer(async (request, response) => {
    try {
      await handleRealWorldHttp({ request, response, path: new URL(request.url!, 'http://localhost').pathname,
        realWorld: svc, tmap, resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
        readBody: async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          return JSON.parse(Buffer.concat(chunks).toString());
        }, decode: decodeURIComponent,
        send: (status, value) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value)),
        consumeEvent: () => {}, consumeMap: () => { quota++; }, });
    } catch (error) {
      response.writeHead(error instanceof RealWorldError ? error.status : 500,
        { 'content-type': 'application/json' }).end(JSON.stringify({ code: error instanceof RealWorldError ? error.code : 'INTERNAL_ERROR' }));
    }
  });
  server.listen(0); await once(server, 'listening');
  try {
    const address = server.address(); assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/v1/discovery`;
    const origin = { latitude: 37.6, longitude: 127, basis: 'MAP_CENTER' };
    const search = await fetch(`${base}/search`, { method: 'POST', body: JSON.stringify({
      bounds: { west: 126.9, south: 37.5, east: 127.2, north: 37.7 }, zoom: 14, origin, limit: 40,
    }) });
    assert.equal(search.status, 200); assert.deepEqual(seenOrigin, origin);
    const walk = await fetch(`${base}/walking-routes`, { method: 'POST', body: JSON.stringify({
      origin, merchantIds: ['m1'], departureAt: '2026-10-06T00:00:00Z', dwellMinutes: [10],
    }) });
    assert.equal(walk.status, 200);
    const route = await walk.json();
    assert.equal(route.mode, 'WALK'); assert.deepEqual(route.stops[0].warnings, ['ORDER_CLOSED']);
    assert.equal(walked, 1); assert.equal(quota, 1);
  } finally { server.close(); await once(server, 'close'); }
});

test('map configuration and client limiter stop upstream calls', async () => {
  let upstream = 0;
  const svc = {} as PostgresRealWorldService;
  const make = (configured: boolean, consumeMap: () => void) => handleRealWorldHttp({
    request: { method: 'POST' } as never, response: {} as never, path: '/v1/discovery/places/search',
    realWorld: svc, tmap: { configured: () => configured, places: async () => { upstream++; return {} as never; } } as unknown as TmapProvider,
    resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
    readBody: async () => ({ query: '서울' }), decode: decodeURIComponent,
    send: () => {}, consumeEvent: () => {}, consumeMap,
  });
  await assert.rejects(make(false, () => { throw Error('should not consume'); }),
    (error: unknown) => error instanceof RealWorldError && error.code === 'MAP_NOT_CONFIGURED' && error.status === 503);
  await assert.rejects(make(true, () => { throw new RealWorldError('MAP_CLIENT_RATE_LIMITED', 429); }),
    (error: unknown) => error instanceof RealWorldError && error.status === 429);
  assert.equal(upstream, 0);
});

test('HTTP accepts NAVER backup for address and places but keeps walking TMAP-only', async () => {
  let quota = 0, address: unknown, places: unknown;
  const svc = { profile: async () => ({}) } as unknown as PostgresRealWorldService;
  const tmap = { configured: () => false } as TmapProvider;
  const mapProvider = { configuredGeocode: () => true, configuredPlaces: () => true,
    geocode: async () => [{ provider: 'NAVER' }], places: async () => ({ places: [], attribution: 'NAVER' }),
  } as unknown as MapProvider;
  const common = { request: { method: 'POST' } as never, response: {} as never, realWorld: svc, tmap, mapProvider,
    resolveAccountId: async () => 'account', resolveWebAccountId: async () => 'owner',
    decode: decodeURIComponent, consumeEvent: () => {}, consumeMap: () => { quota++; } };
  await handleRealWorldHttp({ ...common, path: '/api/web/v1/merchant/merchants/m1/location-candidates',
    readBody: async () => ({ address: '서울시청' }), send: (_status, value) => { address = value; } });
  assert.equal((address as { candidates: { provider: string }[] }).candidates[0]?.provider, 'NAVER');
  await handleRealWorldHttp({ ...common, path: '/v1/discovery/places/search',
    readBody: async () => ({ query: '서울시청' }), send: (_status, value) => { places = value; } });
  assert.equal((places as { attribution: string }).attribution, 'NAVER');
  assert.equal(quota, 2);
  await assert.rejects(handleRealWorldHttp({ ...common, path: '/v1/discovery/walking-routes',
    readBody: async () => ({ origin: { latitude: 37, longitude: 127 }, merchantIds: ['m1'],
      departureAt: '2026-10-07T00:00:00Z', dwellMinutes: [10] }), send: () => {}, }),
  (error: unknown) => error instanceof RealWorldError && error.code === 'MAP_NOT_CONFIGURED');
  assert.equal(quota, 2);
});
