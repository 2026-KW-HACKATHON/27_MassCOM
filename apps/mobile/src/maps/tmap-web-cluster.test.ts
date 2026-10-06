import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMapMarkers, markerIcon, selectMarkerGroup } from './tmap-web-cluster';
import type { MapMarker } from './tmap-view';

const markers: MapMarker[] = [
  { id: 'floor-1', latitude: 37.6, longitude: 127.1, title: '1층', state: 'unvisited' },
  { id: 'floor-2', latitude: 37.6, longitude: 127.1, title: '2층', state: 'visited' },
  { id: 'next-building', latitude: 37.600001, longitude: 127.1, title: '옆 건물', state: 'complete' },
];
test('exact same-building coordinates yield one count marker with all selectable leaf IDs', () => {
  const groups = groupMapMarkers(markers);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]?.ids, ['floor-1', 'floor-2']);
  assert.equal(groups[0]?.title, '2곳');
  assert.deepEqual(groups[1]?.ids, ['next-building']);
  assert.notEqual(markerIcon(groups[0]!, 'floor-2'), markerIcon(groups[0]!, null));
  assert.match(decodeURIComponent(markerIcon(groups[0]!, null)), />2<\/text>/);
});

test('zoom redraws never merge adjacent buildings or discard a leaf', () => {
  for (const zoom of [12, 16, 19]) {
    const groups = groupMapMarkers(markers); // Marker coordinates are invariant under camera zoom.
    assert.equal(groups.flatMap(group => group.ids).length, markers.length, `zoom ${zoom}`);
    assert.deepEqual(groups.map(group => group.ids.length), [2, 1]);
  }
});


test('cluster click opens leaf IDs; individual click retains direct selection', () => {
  const groups = groupMapMarkers(markers);
  const selected: string[] = [], opened: string[][] = [];
  selectMarkerGroup(groups[0]!, id => selected.push(id), ids => opened.push(ids));
  selectMarkerGroup(groups[1]!, id => selected.push(id), ids => opened.push(ids));
  assert.deepEqual(opened, [['floor-1', 'floor-2']]);
  assert.deepEqual(selected, ['next-building']);
  opened[0]!.pop();
  assert.deepEqual(groups[0]!.ids, ['floor-1', 'floor-2']);
});


test('server cluster counts stay visible and its pseudo ID selects without double grouping', () => {
  const groups = groupMapMarkers([...markers, { id: 'cluster-page', latitude: 37.6, longitude: 127.1, title: '전체 클러스터', count: 17, state: 'external' }]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[2]?.ids, ['cluster-page']);
  assert.match(decodeURIComponent(markerIcon(groups[2]!, null)), />17<\/text>/);
  const selected: string[] = [], opened: string[][] = [];
  selectMarkerGroup(groups[2]!, id => selected.push(id), ids => opened.push(ids));
  assert.deepEqual(selected, ['cluster-page']);
  assert.deepEqual(opened, []);
});

test('server cluster count one remains visible and selects its pseudo ID', () => {
  const group = groupMapMarkers([{ id: 'cluster-one', latitude: 37.6, longitude: 127.1, title: '한 곳', count: 1, state: 'external' }])[0]!;
  assert.match(decodeURIComponent(markerIcon(group, null)), />1<\/text>/);
  const selected: string[] = [];
  selectMarkerGroup(group, id => selected.push(id));
  assert.deepEqual(selected, ['cluster-one']);
});
