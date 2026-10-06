import assert from 'node:assert/strict';
import test from 'node:test';
import { NaverProvider } from './naver-provider.js';
import { RealWorldError } from './real-world-contract.js';

test('NAVER geocode and local search keep source, coordinates, and keys separate', async () => {
  const calls: string[] = [];
  const provider = new NaverProvider({ mapsId: 'maps-id', mapsSecret: 'maps-secret', searchId: 'search-id', searchSecret: 'search-secret',
    now: () => new Date('2026-10-07T00:00:00Z'), fetch: async (input, init) => {
      const url = String(input), headers = new Headers(init?.headers);
      if (url.includes('map-geocode')) {
        assert.equal(new URL(url).origin, 'https://maps.apigw.ntruss.com');
        assert.equal(new URL(url).pathname, '/map-geocode/v2/geocode');
        assert.equal(headers.get('x-ncp-apigw-api-key-id'), 'maps-id');
        assert.equal(headers.get('x-ncp-apigw-api-key'), 'maps-secret');
        assert.equal(headers.get('X-Naver-Client-Id'), null);
        calls.push('geocode');
        return Response.json({ status: 'OK', addresses: [{ roadAddress: '서울시청', x: '126.978', y: '37.566' }] });
      }
      assert.equal(headers.get('X-Naver-Client-Id'), 'search-id');
      assert.equal(headers.get('X-Naver-Client-Secret'), 'search-secret');
      assert.equal(headers.get('x-ncp-apigw-api-key-id'), null);
      calls.push('places');
      return Response.json({ items: [{ title: '<b>서울</b>시청', roadAddress: '서울시청', mapx: 1269780000, mapy: 375660000 },
        { title: '좌표 없음', mapx: null, mapy: null }] });
    } });
  const candidate = (await provider.geocode('서울시청'))[0];
  assert.equal(candidate?.provider, 'NAVER');
  assert.deepEqual(candidate?.point, { latitude: 37.566, longitude: 126.978 });
  const page = await provider.places({ query: '서울시청' });
  assert.equal(page.attribution, 'NAVER');
  assert.equal(page.places[0]?.name, '서울시청');
  assert.equal(page.places.length, 1);
  assert.deepEqual(page.places[0]?.point, { latitude: 37.566, longitude: 126.978 });
  assert.equal(page.nextCursor, null);
  assert.deepEqual(calls, ['geocode', 'places']);
});

test('NAVER provider does not leak upstream body and rejects unsupported cursor before request', async () => {
  let calls = 0;
  const provider = new NaverProvider({ searchId: 'id', searchSecret: 'secret',
    fetch: async () => { calls++; return new Response('sensitive response', { status: 403 }); } });
  await assert.rejects(provider.places({ query: '서울', cursor: '2' }),
    (error: unknown) => error instanceof RealWorldError && error.code === 'INVALID_CURSOR');
  assert.equal(calls, 0);
  await assert.rejects(provider.places({ query: '서울' }),
    (error: unknown) => error instanceof RealWorldError && error.code === 'MAP_AUTH_FAILED' && !error.message.includes('sensitive'));
});
