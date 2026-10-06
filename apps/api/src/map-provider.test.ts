import assert from 'node:assert/strict';
import test from 'node:test';
import { MapProvider } from './map-provider.js';
import { RealWorldError } from './real-world-contract.js';
import type { NaverProvider } from './naver-provider.js';
import type { TmapProvider } from './tmap-provider.js';

test('TMAP stays primary; NAVER handles only eligible failures and never valid empties', async () => {
  let primary = 0, backup = 0, failure: RealWorldError | null = null;
  const tmap = { configured: () => true, geocode: async () => { primary++; if (failure) throw failure; return []; },
    places: async () => { primary++; if (failure) throw failure; return { places: [], nextCursor: null, attribution: 'TMAP' }; } } as unknown as TmapProvider;
  const naver = { configuredGeocode: () => true, configuredPlaces: () => true,
    geocode: async () => { backup++; return [{ provider: 'NAVER' }]; },
    places: async () => { backup++; return { places: [{ provider: 'NAVER' }], attribution: 'NAVER' }; } } as unknown as NaverProvider;
  const map = new MapProvider(tmap, naver);
  assert.deepEqual(await map.geocode('서울'), []);
  assert.deepEqual((await map.places({ query: '서울' })).places, []);
  assert.equal(backup, 0);
  failure = new RealWorldError('MAP_TIMEOUT', 503, true);
  assert.equal((await map.geocode('서울'))[0]?.provider, 'NAVER');
  assert.equal((await map.places({ query: '서울' })).attribution, 'NAVER');
  assert.equal(backup, 2);
  await assert.rejects(map.places({ query: '서울', cursor: '2' }), (e: unknown) => e === failure);
  failure = new RealWorldError('INVALID_QUERY');
  await assert.rejects(map.geocode(''), (e: unknown) => e === failure);
  assert.equal(backup, 2);
  assert.equal(primary, 6);
});

test('NAVER-only geocode works without local-search credentials', async () => {
  const tmap = { configured: () => false } as TmapProvider;
  const naver = { configuredGeocode: () => true, configuredPlaces: () => false,
    geocode: async () => [] } as unknown as NaverProvider;
  const map = new MapProvider(tmap, naver);
  assert.equal(map.configuredGeocode(), true);
  assert.equal(map.configuredPlaces(), false);
  assert.deepEqual(await map.geocode('서울'), []);
});
