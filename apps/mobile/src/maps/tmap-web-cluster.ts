import type { MapMarker } from './tmap-view';

export type MarkerGroup = { latitude: number; longitude: number; ids: string[]; title: string; state: MapMarker['state']; count?: number };

/** Only identical owned coordinates share a marker; nearby buildings remain distinct at every zoom. */
export function groupMapMarkers(markers: readonly MapMarker[]): MarkerGroup[] {
  const groups = new Map<string, MarkerGroup>();
  const standalone: MarkerGroup[] = [];
  for (const marker of markers) {
    if (!Number.isFinite(marker.latitude) || !Number.isFinite(marker.longitude) ||
      Math.abs(marker.latitude) > 90 || Math.abs(marker.longitude) > 180) continue;
    if (marker.count !== undefined) {
      if (Number.isInteger(marker.count) && marker.count > 0) standalone.push({ latitude: marker.latitude, longitude: marker.longitude,
        ids: [marker.id], title: marker.title, state: marker.state, count: marker.count });
      continue;
    }
    const key = `${marker.latitude},${marker.longitude}`;
    const group = groups.get(key);
    if (group) {
      group.ids.push(marker.id);
      group.title = `${group.ids.length}곳`;
    } else {
      groups.set(key, { latitude: marker.latitude, longitude: marker.longitude,
        ids: [marker.id], title: marker.title, state: marker.state });
    }
  }
  return [...groups.values(), ...standalone];
}

export function markerIcon(group: MarkerGroup, selectedId: string | null): string {
  const selected = selectedId !== null && group.ids.includes(selectedId);
  const count = group.count ?? group.ids.length;
  const fill = count > 1 ? '#33649b' : group.state === 'complete' ? '#c08423'
    : group.state === 'visited' ? '#2b8069' : group.state === 'external' ? '#5c6d81' : '#cd4d3f';
  const label = group.count !== undefined || group.ids.length > 1 ? String(count) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" fill="${fill}" stroke="white" stroke-width="${selected ? 6 : 3}"/><text x="22" y="28" text-anchor="middle" font-size="17" font-weight="bold" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function selectMarkerGroup(group: MarkerGroup, onSelect?: (id: string) => void, onCluster?: (ids: string[]) => void): void {
  if (group.ids.length === 1) onSelect?.(group.ids[0]!);
  else onCluster?.([...group.ids]);
}
