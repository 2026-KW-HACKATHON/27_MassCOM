import assert from 'node:assert/strict';
import test from 'node:test';

import type { DiscoveryPage, DiscoveryQuery } from '../../../api/src/real-world-contract';
import { createDiscoveryState, restoreDiscoveryNavigation, serializeDiscoveryNavigation } from './discovery-state';
import { createDiscoveryApiClient } from './discovery-api';

const bounds = { west: 127.01, south: 37.61, east: 127.08, north: 37.66 };
const queryA: DiscoveryQuery = { bounds, zoom: 14, query: 'A' };
const queryB: DiscoveryQuery = { bounds, zoom: 14, query: 'B' };
const page = (id: string, nextCursor: string | null = null): DiscoveryPage => ({ schemaVersion: 1, asOf: '2026-10-06T00:00:00Z', merchants: [{ id, name: id, roadAddress: '도로', category: null, demo: false, profileVersion: 1, position: {latitude: 37.62, longitude: 127.03}, positionBasis: 'OWNED', positionExpiresAt: null, floor: null, entranceNote: null, thumbnail: null, business: {state:'UNKNOWN',basis:'UNKNOWN',evaluatedAt:'2026-10-06T00:00:00Z',nextChangeAt:null,informationUpdatedAt:null,acceptingOrders:null,lastOrderAt:null}, campaign:null,distance:null }], clusters: [], nextCursor, unlocatedCount: 0 });

test('late A cannot replace better B; cursor is tied to active filters', () => {
  const state = createDiscoveryState();
  const a = state.begin(queryA); const b = state.begin(queryB);
  state.resolve(b, page('B', 'next')); state.resolve(a, page('A'));
  assert.equal(state.snapshot().query?.query, 'B');
  assert.deepEqual(state.snapshot().merchants.map((item) => item.id), ['B']);
  const cursor = state.beginNext();
  assert.equal(cursor?.cursor, 'next');
  state.setFilters({query:'C'});
  assert.equal(state.beginNext(), null);
  state.resolve(cursor!, page('C'));
  assert.equal(state.snapshot().merchants.length, 0);
});

test('same building keeps each merchant ID; selection survives list/map return', () => {
  const state = createDiscoveryState(); const req = state.begin(queryA);
  state.resolve(req, {...page('a'), merchants:[page('a').merchants[0], {...page('a').merchants[0],id:'b'}]});
  state.select('b');
  assert.deepEqual(state.snapshot().merchants.map(m=>m.id), ['a','b']);
  assert.equal(state.snapshot().selectedId, 'b');
});

test('restore stores filters and selection but no GPS, route geometry or provider data', () => {
  const state = createDiscoveryState(); state.setFilters({query:'cake',openOnly:true}); state.select('shop');
  state.setOrigin({latitude:37.6,longitude:127,basis:'CURRENT_LOCATION'});
  const saved = serializeDiscoveryNavigation(state.snapshot());
  assert.doesNotMatch(saved, /37\.6|127|CURRENT_LOCATION|geometry/);
  const restored = restoreDiscoveryNavigation(saved);
  assert.equal(restored.filters.query, 'cake'); assert.equal(restored.selectedId, 'shop');
  assert.equal(createDiscoveryState(restored).snapshot().origin, null);
});

test('cold return restores a chosen manual origin but never restores a GPS fix', () => {
  const state=createDiscoveryState();state.setOrigin({latitude:37.621,longitude:127.055,basis:'MANUAL'});
  const saved=serializeDiscoveryNavigation(state.snapshot());
  assert.deepEqual(createDiscoveryState(restoreDiscoveryNavigation(saved)).snapshot().origin,{latitude:37.621,longitude:127.055,basis:'MANUAL'});
  state.setOrigin({latitude:37.999,longitude:127.999,basis:'CURRENT_LOCATION'});
  const gpsSaved=serializeDiscoveryNavigation(state.snapshot());
  assert.doesNotMatch(gpsSaved,/37\.999|127\.999|CURRENT_LOCATION/);
});


test('expired provider-derived manual origin is discarded on cold return',()=>{
  const state=createDiscoveryState();state.setOrigin({latitude:37.5,longitude:127,basis:'MANUAL'},new Date(Date.now()+1000).toISOString());
  const saved=JSON.parse(serializeDiscoveryNavigation(state.snapshot()));saved.manualOriginExpiresAt=new Date(Date.now()-1000).toISOString();
  assert.equal(createDiscoveryState(restoreDiscoveryNavigation(JSON.stringify(saved))).snapshot().origin,null);
});

test('choosing a map camera as a manual origin sends coordinates without the camera zoom', async () => {
  const state = createDiscoveryState();
  const camera = { latitude: 37.6206, longitude: 127.0567, zoom: 14 };
  state.setOrigin({ ...camera, basis: 'MANUAL' });
  let body: any;
  const api = createDiscoveryApiClient({ apiUrl: 'https://api.example', fetcher: (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return Response.json({ ...page('a'), merchants: [] });
  }) as typeof fetch });
  await api.search({ ...queryA, origin: state.snapshot().origin! });
  assert.deepEqual(body.origin, { latitude: 37.6206, longitude: 127.0567, basis: 'MANUAL' });
  assert.equal(camera.zoom, 14);
});
