import assert from 'node:assert/strict';
import test from 'node:test';
import { TmapWebSession } from './tmap-web-session';
import type { Sdk, WebMap } from './tmap-web-sdk';
import type { TmapMapProps } from './tmap-view';

const point = (latitude: number, longitude: number) => ({ latitude: () => latitude, longitude: () => longitude });
const bounds = { getSouthWest: () => point(37.5, 127), getNorthEast: () => point(37.7, 127.2) };

test('same props after inactive teardown create a fresh ready map with camera, overlays and callbacks', () => {
  const maps: { map: WebMap; fire: () => void; destroyed: () => boolean; markerClicks: (() => void)[]; icons: string[]; lineCount: () => number }[] = [];
  const selected: string[] = [], clusters: string[][] = [], viewports: number[] = [];
  let readyCount = 0;
  let markerRemoved = 0, lineRemoved = 0;
  let polylineCount = 0;
  const markerEvents: string[] = [];
  const sdk = {
    LatLng: class { constructor(public latitudeValue: number, public longitudeValue: number) {} latitude() { return this.latitudeValue; } longitude() { return this.longitudeValue; } },
    Map: class {
      private listeners = new Map<string, () => void>();
      private center = point(0, 0);
      private zoom = 0;
      private dead = false;
      markerClicks: (() => void)[] = [];
      icons: string[] = [];
      constructor(_id: string, options: { center: ReturnType<typeof point>; zoom: number }) {
        this.center = options.center; this.zoom = options.zoom;
        maps.push({ map: this as unknown as WebMap, fire: () => this.listeners.get('ConfigLoad')?.(), destroyed: () => this.dead,
          markerClicks: this.markerClicks, icons: this.icons, lineCount: () => polylineCount });
      }
      on(event: string, callback: () => void) { this.listeners.set(event, callback); }
      setCenter(value: ReturnType<typeof point>) { this.center = value; }
      setZoom(value: number) { this.zoom = value; }
      getCenter() { return this.center; }
      getZoom() { return this.zoom; }
      getBounds() { return bounds; }
      resize() {}
      destroy() { this.dead = true; }
    },
    Marker: class {
      constructor(options: { map: { markerClicks: (() => void)[]; icons: string[] }; icon: string }) { options.map.icons.push(options.icon); this.map = options.map; }
      private map: { markerClicks: (() => void)[] };
      on(event: string, callback: () => void) { markerEvents.push(event); this.map.markerClicks.push(callback); }
      setMap(value: unknown) { if (value === null) markerRemoved++; }
    },
    Polyline: class { constructor() { polylineCount++; } setMap(value: unknown) { if (value === null) lineRemoved++; } },
  } as unknown as Sdk;
  const snapshot: Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'> = {
    camera: { latitude: 37.6, longitude: 127.1, zoom: 16 },
    markers: [{ id: 'one', latitude: 37.6, longitude: 127.1, title: '1층', state: 'unvisited' },
      { id: 'two', latitude: 37.6, longitude: 127.1, title: '2층', state: 'visited' }],
    selectedId: 'two', route: { type: 'MultiLineString', coordinates: [[[127.1, 37.6], [127.11, 37.61]]] },
  };
  const callbacks = () => ({ onReady: () => { readyCount++; }, onViewport: (value: { camera: { zoom: number } }) => { viewports.push(value.camera.zoom); },
    onSelect: (id: string) => selected.push(id), onCluster: (ids: string[]) => clusters.push(ids) });
  const first = new TmapWebSession(sdk, 'map-1', snapshot, callbacks);
  maps[0]!.fire();
  maps[0]!.markerClicks[0]!();
  assert.deepEqual(markerEvents, ['click']);
  assert.deepEqual(clusters, [['one', 'two']]);
  first.dispose();
  assert.equal(maps[0]!.destroyed(), false); // Web Vector JS documents overlay removal, not Map.destroy().
  assert.equal(markerRemoved, 1);
  assert.equal(lineRemoved, 1);
  const second = new TmapWebSession(sdk, 'map-2', snapshot, callbacks);
  maps[1]!.fire();
  assert.equal(readyCount, 2);
  assert.deepEqual(viewports, [16, 16]);
  assert.equal(maps[1]!.icons.length, 1);
  assert.equal(polylineCount, 2);
  assert.deepEqual([maps[1]!.map.getCenter().latitude(), maps[1]!.map.getCenter().longitude()], [37.6, 127.1]);
  maps[1]!.markerClicks[0]!();
  assert.deepEqual(clusters[1], ['one', 'two']);
  assert.deepEqual(selected, []);
  second.dispose();
});


test('map readiness timeout reports failure once and ignores late ConfigLoad', async () => {
  let configLoad: (() => void) | undefined;
  let failures = 0, ready = 0;
  const sdk = {
    LatLng: class { constructor(public y: number, public x: number) {} latitude() { return this.y; } longitude() { return this.x; } },
    Map: class {
      on(_event: string, callback: () => void) { configLoad = callback; }
      setZoom() {} setCenter() {} getZoom() { return 16; } getCenter() { return point(37.6, 127.1); } getBounds() { return bounds; } resize() {}
    },
    Marker: class {}, Polyline: class {},
  } as unknown as Sdk;
  const snapshot: Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'> = {
    camera: { latitude: 37.6, longitude: 127.1, zoom: 16 }, markers: [], selectedId: null, route: null,
  };
  const session = new TmapWebSession(sdk, 'pending-map', snapshot, () => ({ onReady: () => { ready++; } }), () => { failures++; }, 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(failures, 1);
  configLoad?.();
  assert.equal(ready, 0);
  session.dispose();
  assert.equal(failures, 1);
});
