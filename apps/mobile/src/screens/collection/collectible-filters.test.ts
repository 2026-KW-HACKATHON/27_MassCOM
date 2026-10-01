import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectibleFilterOptions, filterAndSortAlbum, filterCollectibleGroups, sortCollectibleGroups } from './collectible-filters';
import type { CollectibleGroup, UngroupedCollectible } from './collectible-groups';

const baseArtwork = { publicationId: 'p', projectId: 'proj', gradeId: 'g1', gradeName: '1등급', name: '이름', shape: 'circle' as const, theme: { name: '가을' }, thumbnailDataUrl: 'data:image/png;base64,aa==' };

function group(overrides: Partial<CollectibleGroup> & Pick<CollectibleGroup, 'key' | 'merchantId' | 'merchantName'>): CollectibleGroup {
  return {
    artwork: baseArtwork,
    count: 1,
    entitlementIds: ['e1'],
    earnedDates: ['2026-09-01T00:00:00.000Z'],
    entitlements: [{ entitlementId: 'e1', earnedAt: '2026-09-01T00:00:00.000Z', nftStatus: 'NOT_REQUESTED', nft: null, recipient: null }],
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

function legacyItem(overrides: Partial<UngroupedCollectible> & Pick<UngroupedCollectible, 'entitlementId' | 'merchantId' | 'merchantName'>): UngroupedCollectible {
  return {
    displayName: '옛 보상',
    campaignTitle: '캠페인',
    targetVisitCount: 1,
    earnedAt: '2026-09-01T00:00:00.000Z',
    nftStatus: 'NOT_REQUESTED',
    nft: null,
    recipient: null,
    ...overrides,
  };
}

// 다 가게(m3)는 그림 있는 그룹이 하나도 없고, 옛(그림 없는) 보상만 있다 — 가장 최근에 받음(09-25).
const legacy: UngroupedCollectible[] = [
  legacyItem({ entitlementId: 'l1', merchantId: 'm3', merchantName: '다 가게', earnedAt: '2026-09-25T00:00:00.000Z' }),
];

// PR #301 리뷰: legacy(그림 없는) 수집품이 필터·정렬 없이 그냥 이어 붙던 문제. 가게 선택이 다른 가게의 legacy 카드를
// 가리지 못했고, 가게 선택 목록에도 legacy만 있는 가게가 빠져 있었다.
test('collectibleFilterOptions lists a store whose only reward is a legacy (no-picture) entitlement', () => {
  const options = collectibleFilterOptions(groups, legacy);
  assert.deepEqual(options.merchants, [{ id: 'm2', name: '가 가게' }, { id: 'm1', name: '나 가게' }, { id: 'm3', name: '다 가게' }]);
});

test('collectibleFilterOptions with no legacy argument behaves exactly as before (back-compat)', () => {
  assert.deepEqual(collectibleFilterOptions(groups).merchants, [{ id: 'm2', name: '가 가게' }, { id: 'm1', name: '나 가게' }]);
});

test('filterAndSortAlbum hides other stores\' legacy cards when a store filter is active', () => {
  const entries = filterAndSortAlbum(groups, legacy, { merchantId: 'm1' }, 'recent');
  assert.deepEqual(entries.map((entry) => (entry.kind === 'group' ? entry.group.key : entry.item.entitlementId)), ['a']);
});

test('filterAndSortAlbum keeps a legacy card when its own store is selected', () => {
  const entries = filterAndSortAlbum(groups, legacy, { merchantId: 'm3' }, 'recent');
  assert.deepEqual(entries.map((entry) => (entry.kind === 'group' ? entry.group.key : entry.item.entitlementId)), ['l1']);
});

test('filterAndSortAlbum sorts grouped and legacy cards together, not legacy always last', () => {
  // l1 was earned 09-25, after group b (09-20) and group a (09-10): newest-first must put it ahead of both.
  const entries = filterAndSortAlbum(groups, legacy, {}, 'recent');
  assert.deepEqual(entries.map((entry) => (entry.kind === 'group' ? entry.group.key : entry.item.entitlementId)), ['l1', 'b', 'a']);
});

test('filterAndSortAlbum drops legacy cards once a theme or grade filter is active (neither ever matches)', () => {
  assert.deepEqual(filterAndSortAlbum(groups, legacy, { theme: '겨울' }, 'recent').map((entry) => entry.kind), ['group']);
  assert.deepEqual(filterAndSortAlbum(groups, legacy, { gradeId: 'g1' }, 'recent').map((entry) => entry.kind), ['group']);
});
