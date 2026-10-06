import assert from 'node:assert/strict';
import test from 'node:test';
import { TmapProvider } from './tmap-provider.js';
import { runTmapSmoke } from './tmap-smoke-command.js';

test('smoke exercises the shared provider and reports only sanitized REST evidence', async () => {
  const calls: string[] = [];
  const provider = new TmapProvider({ appKey: 'private-test-key', fetch: async (input, init) => {
    calls.push(String(input));
    assert.equal(new Headers(init?.headers).get('appKey'), 'private-test-key');
    if (String(input).includes('/pois?')) return Response.json({ searchPoiInfo: { totalCount: '1', pois: {
      poi: [{ id: '1', name: 'private-name', noorLat: '37.566', noorLon: '126.975' }] } } });
    if (String(input).includes('/fullAddrGeo?')) return Response.json({ coordinateInfo: {
      coordinate: [{ newLat: '37.566', newLon: '126.977' }] } });
    assert.equal(init?.method, 'POST');
    assert.deepEqual([JSON.parse(String(init?.body)).startX, JSON.parse(String(init?.body)).endX], [126.977, 126.975]);
    return Response.json({ type: 'FeatureCollection', features: [
      { geometry: { type: 'Point' }, properties: { pointType: 'SP', totalDistance: 280, totalTime: 210 } },
      { geometry: { type: 'LineString', coordinates: [[126.977, 37.566], [126.975, 37.566]] }, properties: {} },
      { geometry: { type: 'Point' }, properties: { pointType: 'EP' } },
    ] });
  } });
  assert.deepEqual(await runTmapSmoke(provider), { status: 'PASS', scope: 'TMAP_REST', poiCount: 1,
    addressCandidateCount: 1, walkingMeters: 280, walkingSeconds: 210, lineCount: 1 });
  assert.equal(calls.length, 3);
  assert.match(calls[2]!, /routes\/pedestrian/);
  const absent = new TmapProvider({ fetch: async () => { throw Error('must not call'); } });
  assert.deepEqual(await runTmapSmoke(absent), { status: 'FAIL', scope: 'TMAP_REST', code: 'MAP_NOT_CONFIGURED' });
  const broken = new TmapProvider({ appKey: 'private-test-key', fetch: async () => { throw Error('private-test-key raw-response'); } });
  assert.deepEqual(await runTmapSmoke(broken), { status: 'FAIL', scope: 'TMAP_REST', code: 'MAP_UPSTREAM_FAILED' });
  const empty = new TmapProvider({ appKey: 'private-test-key', fetch: async (input) => Response.json(
    String(input).includes('/pois?') ? { searchPoiInfo: { totalCount: '0', pois: {} } } : { coordinateInfo: { totalCount: '0' } }) });
  assert.deepEqual(await runTmapSmoke(empty), { status: 'FAIL', scope: 'TMAP_REST', code: 'MAP_EMPTY_RESPONSE' });
});
