import type { Bounds, Point } from '../../../../api/src/real-world-contract';
import type { MapCamera } from '@/maps/tmap-view';

export function validMapViewport(value: { bounds: Bounds; camera: MapCamera }): boolean {
  const { bounds, camera } = value;
  return [bounds.west, bounds.south, bounds.east, bounds.north, camera.latitude, camera.longitude, camera.zoom]
    .every(Number.isFinite) && bounds.west >= -180 && bounds.east <= 180 && bounds.south >= -90 && bounds.north <= 90 &&
    bounds.west < bounds.east && bounds.south < bounds.north && Math.abs(camera.latitude) <= 90 &&
    Math.abs(camera.longitude) <= 180 && camera.zoom >= 1 && camera.zoom <= 20;
}

export function boundsAround(point: Point, reference: Bounds): Bounds {
  const halfWidth = (reference.east - reference.west) / 2;
  const halfHeight = (reference.north - reference.south) / 2;
  return { west: Math.max(-180, point.longitude - halfWidth), east: Math.min(180, point.longitude + halfWidth),
    south: Math.max(-90, point.latitude - halfHeight), north: Math.min(90, point.latitude + halfHeight) };
}
