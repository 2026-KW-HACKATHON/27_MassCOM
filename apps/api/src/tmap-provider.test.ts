import assert from 'node:assert/strict';
import test from 'node:test';
import { RealWorldError } from './real-world-contract.js';
import { TmapProvider, parseWalkingResponse, toTmapPoint } from './tmap-provider.js';

const pedestrian = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [127.1, 37.6] }, properties: { pointType: 'SP', totalDistance: 320, totalTime: 240 } },
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[127.1, 37.6], [127.11, 37.61]] }, properties: { roadType: 23 } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: [127.11, 37.61] }, properties: { pointType: 'EP' } },
] };
const automobile = { type: 'FeatureCollection', features: [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [127.1, 37.6] }, properties: { pointType: 'S', totalDistance: 320, totalTime: 240, taxiFare: 3500 } },
  { type: 'Feature', geometry: { type: 'LineString', coordinates: [[127.1, 37.6], [127.11, 37.61]] }, properties: {} },
] };

test('point order and only pedestrian response accepted', () => {
  assert.deepEqual(toTmapPoint({ latitude: 37.6, longitude: 127.1 }), { x: 127.1, y: 37.6 });
  assert.deepEqual(parseWalkingResponse(pedestrian).geometry.coordinates, [[[127.1, 37.6], [127.11, 37.61]]]);
  assert.equal(parseWalkingResponse(pedestrian).mode, 'WALK');
  assert.throws(() => parseWalkingResponse(automobile));
  assert.throws(() => parseWalkingResponse({ ...pedestrian, features: pedestrian.features.slice(1) }));
});

test('unconfigured provider cannot call upstream', async () => {
  const provider = new TmapProvider({ fetch: async () => { throw Error('called'); } });
  assert.equal(provider.configured(), false);
  await assert.rejects(provider.walk({ latitude: 37.6, longitude: 127.1 }, { latitude: 37.61, longitude: 127.11 }), (e: unknown) => e instanceof RealWorldError && e.code === 'MAP_NOT_CONFIGURED' && e.status === 503);
});

test('walking request is pedestrian, cache expires, quota is hard and errors are sanitized', async () => {
  let time = Date.parse('2026-10-06T00:00:00Z');
  const calls: { url: string; body: any }[] = [];
  const provider = new TmapProvider({ appKey: 'test-key', now: () => new Date(time), dailyLimit: 2, fetch: async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(pedestrian), { status: 200 });
  } });
  const a = { latitude: 37.6, longitude: 127.1 };
  const b = { latitude: 37.61, longitude: 127.11 };
  const first = await provider.walk(a, b);
  assert.equal(first.travelMeters, 320);
  assert.equal(first.travelSeconds, 240);
  assert.equal(Date.parse(first.expiresAt) - time < 86_400_000, true);
  await provider.walk(a, b);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /routes\/pedestrian/);
  assert.deepEqual([calls[0]!.body.startX, calls[0]!.body.startY, calls[0]!.body.endX, calls[0]!.body.endY], [127.1, 37.6, 127.11, 37.61]);
  time += 3_600_001;
  await provider.walk(a, b);
  assert.equal(calls.length, 2);
  await assert.rejects(provider.geocode('서울시청'), (e: unknown) => e instanceof RealWorldError && e.code === 'MAP_QUOTA_EXCEEDED');
  const failure = new TmapProvider({ appKey: 'test-key', fetch: async () => new Response('sensitive key and coordinates', { status: 429 }) });
  await assert.rejects(failure.geocode('서울시청'), (e: unknown) => e instanceof RealWorldError && e.message === 'MAP_RATE_LIMITED');
});

test('POI and geocode preserve latitude/longitude and original fetch freshness', async () => {
  let time = Date.parse('2026-10-06T00:00:00Z');
  let calls = 0;
  const provider = new TmapProvider({ appKey: 'test-key', now: () => new Date(time), fetch: async (input) => {
    calls++;
    if (String(input).includes('/fullAddrGeo?')) assert.equal(new URL(String(input)).searchParams.get('addressFlag'), 'F00');
    const payload = String(input).includes('/pois?')
      ? { searchPoiInfo: { totalCount: '1', pois: { poi: [{ id: 'poi-1', name: '서점', noorLat: '37.6', noorLon: '127.1', frontLat: '37.61', frontLon: '127.11', upperAddrName: '서울', roadName: '길' }] } } }
      : { coordinateInfo: { coordinate: [{ newLat: '37.7', newLon: '127.2', newLatEntr: '37.71', newLonEntr: '127.21', newRoadName: '거리' }] } };
    return new Response(JSON.stringify(payload));
  } });
  const first = await provider.places({ query: '서점' });
  assert.deepEqual(first.places[0]?.point, { latitude: 37.6, longitude: 127.1 });
  assert.deepEqual(first.places[0]?.entrance, { latitude: 37.61, longitude: 127.11 });
  time += 30_000;
  const cached = await provider.places({ query: '서점' });
  assert.equal(cached.fetchedAt, first.fetchedAt);
  assert.equal(cached.expiresAt, first.expiresAt);
  assert.equal(calls, 1);
  const candidates = await provider.geocode('서울 거리');
  assert.deepEqual(candidates[0]?.point, { latitude: 37.7, longitude: 127.2 });
  assert.deepEqual(candidates[0]?.entrance, { latitude: 37.71, longitude: 127.21 });
  assert.equal(candidates[0]?.participation, 'EXTERNAL_PLACE');
});

test('valid empty provider searches do not invent locations', async () => {
  const provider = new TmapProvider({ appKey: 'test-key', fetch: async (input) => new Response(JSON.stringify(
    String(input).includes('/pois?') ? { searchPoiInfo: { totalCount: '0', pois: {} } } : { coordinateInfo: { totalCount: '0' } }
  )) });
  assert.deepEqual((await provider.places({ query: '없는가게' })).places, []);
  assert.deepEqual(await provider.geocode('없는주소'), []);
});
