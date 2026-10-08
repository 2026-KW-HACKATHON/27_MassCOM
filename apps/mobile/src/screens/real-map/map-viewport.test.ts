import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsAround, validMapViewport } from './map-viewport';

const camera = { latitude: 37.62, longitude: 127.05, zoom: 14 };
const bounds = { west: 127.02, south: 37.60, east: 127.08, north: 37.64 };

test('ignore zero-size and invalid map initialization viewports', () => {
  assert.equal(validMapViewport({ camera, bounds }), true);
  assert.equal(validMapViewport({ camera, bounds: { west: 0, east: 0, south: 0, north: 0 } }), false);
  assert.equal(validMapViewport({ camera, bounds: { ...bounds, east: Number.NaN } }), false);
  assert.equal(validMapViewport({ camera: { ...camera, zoom: 25 }, bounds }), false);
});

test('recenter search bounds around a chosen location without changing the departure point', () => {
  const point = { latitude: 37.634, longitude: 127.06 };
  const moved = boundsAround(point, bounds);
  assert.ok(Math.abs(moved.west - 127.03) < 1e-9 && Math.abs(moved.east - 127.09) < 1e-9);
  assert.ok(Math.abs(moved.south - 37.614) < 1e-9 && Math.abs(moved.north - 37.654) < 1e-9);
});
