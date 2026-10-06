import assert from 'node:assert/strict';
import test from 'node:test';
import { NaverWebSession } from './naver-web-session';
import type { NaverMaps } from './naver-web-sdk';
import type { TmapMapProps } from './tmap-view';

const point = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });
const snapshot: Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'> = {
  camera: { latitude: 37.6, longitude: 127.1, zoom: 16 },
  markers: [{ id: 'a', latitude: 37.6, longitude: 127.1, title: 'A', state: 'unvisited' },
    { id: 'b', latitude: 37.6, longitude: 127.1, title: 'B', state: 'visited' }],
  selectedId: null, route: { type: 'MultiLineString', coordinates: [[[127.1, 37.6], [127.11, 37.61]]] },
};
function fakeSdk() {
  const events = new Map<object, { target: object; name: string; callback: () => void }>();
  const maps: { fire: (name: string) => void; destroyed: () => boolean; center: () => ReturnType<typeof point> }[] = [];
  let removed = 0, detached = 0, polylines = 0;
  const sdk = {
    LatLng: class { constructor(private y: number, private x: number) {} lat() { return this.y; } lng() { return this.x; } },
    Map: class {
      private centerValue = point(37.6, 127.1); private zoom = 16; private dead = false;
      constructor(_id: string, options: { center: ReturnType<typeof point>; zoom: number }) {
        this.centerValue = options.center; this.zoom = options.zoom;
        maps.push({ fire: name => { for (const event of events.values()) if (event.target === this && event.name === name) event.callback(); },
          destroyed: () => this.dead, center: () => this.centerValue });
      }
      getBounds() { return { getSW: () => point(37.5, 127), getNE: () => point(37.7, 127.2) }; }
      getCenter() { return this.centerValue; } getZoom() { return this.zoom; }
      setCenter(value: ReturnType<typeof point>) { this.centerValue = value; } setZoom(value: number) { this.zoom = value; }
      autoResize() {} destroy() { this.dead = true; }
    },
    Marker: class { setMap(map: unknown) { if (map === null) detached++; } },
    Polyline: class { constructor(_options: unknown) { polylines++; } setMap(map: unknown) { if (map === null) detached++; } },
    Event: { addListener(target: object, name: string, callback: () => void) { const token = {}; events.set(token, { target, name, callback }); return token; },
      removeListener(token: object) { if (events.delete(token)) removed++; } },
  } as unknown as NaverMaps;
  return { sdk, maps, events, counts: () => ({ removed, detached, polylines }) };
}

test('NAVER init renders current camera, same-building marker and WALK route; dispose removes listeners and map', () => {
  const fake = fakeSdk();
  const selected: string[][] = [], zooms: number[] = [];
  const callbacks = () => ({ onCluster: (ids: string[]) => selected.push(ids), onViewport: (value: { camera: { zoom: number } }) => zooms.push(value.camera.zoom) });
  const first = new NaverWebSession(fake.sdk, 'map-a', snapshot, callbacks);
  fake.maps[0]!.fire('init');
  assert.equal(fake.counts().polylines, 1);
  for (const event of fake.events.values()) if (event.name === 'click') event.callback();
  assert.deepEqual(selected, [['a', 'b']]);
  assert.deepEqual(zooms, [16]);
  first.dispose();
  assert.equal(fake.maps[0]!.destroyed(), true);
  assert.equal(fake.events.size, 0);
  assert.equal(fake.counts().detached, 2);
  const second = new NaverWebSession(fake.sdk, 'map-b', snapshot, callbacks);
  fake.maps[1]!.fire('init');
  assert.deepEqual([fake.maps[1]!.center().lat(), fake.maps[1]!.center().lng()], [37.6, 127.1]);
  assert.equal(fake.counts().polylines, 2);
  second.dispose();
});

test('NAVER init timeout fails once; late init after dispose is ignored', async () => {
  const fake = fakeSdk();
  let failures = 0, ready = 0;
  new NaverWebSession(fake.sdk, 'pending', snapshot, () => ({ onReady: () => { ready++; } }), () => { failures++; }, 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  fake.maps[0]!.fire('init');
  assert.equal(failures, 1);
  assert.equal(ready, 0);
  assert.equal(fake.maps[0]!.destroyed(), true);
});
