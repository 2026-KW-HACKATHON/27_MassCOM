import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectibleFilterOptions, filterCollectibleGroups, sortCollectibleGroups } from './collectible-filters';
import type { CollectibleGroup } from './collectible-groups';

const baseArtwork = { publicationId: 'p', projectId: 'proj', gradeId: 'g1', gradeName: '1등급', name: '이름', shape: 'circle' as const, theme: { name: '가을' }, thumbnailDataUrl: 'data:image/png;base64,aa==' };

function group(overrides: Partial<CollectibleGroup> & Pick<CollectibleGroup, 'key' | 'merchantId' | 'merchantName'>): CollectibleGroup {
  return {
    artwork: baseArtwork,
    count: 1,
    entitlementIds: ['e1'],
    earnedDates: ['2026-09-01T00:00:00.000Z'],
    ...overrides,
  };
}

const groups: CollectibleGroup[] = [
  group({ key: 'a', merchantId: 'm1', merchantName: '나 가게', earnedDates: ['2026-09-10T00:00:00.000Z'] }),
  group({
    key: 'b', merchantId: 'm2', merchantName: '가 가게',
    artwork: { ...baseArtwork, gradeId: 'g2', gradeName: '2등급', theme: { name: '겨울' } },
    earnedDates: ['2026-09-20T00:00:00.000Z'],
  }),
];

test('filter options list distinct stores/themes/grades sorted in Korean order', () => {
  const options = collectibleFilterOptions(groups);
  assert.deepEqual(options.merchants, [{ id: 'm2', name: '가 가게' }, { id: 'm1', name: '나 가게' }]);
  assert.deepEqual(options.themes, ['가을', '겨울']);
  assert.deepEqual(options.grades.map((g) => g.id).sort(), ['g1', 'g2']);
});

test('filterCollectibleGroups narrows by store, theme, and grade independently', () => {
  assert.deepEqual(filterCollectibleGroups(groups, { merchantId: 'm1' }).map((g) => g.key), ['a']);
  assert.deepEqual(filterCollectibleGroups(groups, { theme: '겨울' }).map((g) => g.key), ['b']);
  assert.deepEqual(filterCollectibleGroups(groups, {}).map((g) => g.key), ['a', 'b']);
});

test('sortCollectibleGroups supports recent, store, and grade', () => {
  assert.deepEqual(sortCollectibleGroups(groups, 'recent').map((g) => g.key), ['b', 'a']);
  assert.deepEqual(sortCollectibleGroups(groups, 'store').map((g) => g.key), ['b', 'a']);
  assert.deepEqual(sortCollectibleGroups(groups, 'grade').map((g) => g.key), ['a', 'b']);
});
