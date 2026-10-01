import type { CollectibleGroup, UngroupedCollectible } from './collectible-groups';

export type CollectibleFilterOptions = {
  merchants: readonly { id: string; name: string }[];
  themes: readonly string[];
  grades: readonly { id: string; name: string }[];
};

/**
 * Distinct store / season(theme) / grade choices, built from everything the account actually owns — grouped
 * (pictured) collectibles and, for the store choice only, legacy entitlements with no picture (#296 review: a
 * store whose only rewards are legacy ones must still appear, or its filter chip can never be reached).
 */
export function collectibleFilterOptions(groups: readonly CollectibleGroup[], legacy: readonly UngroupedCollectible[] = []): CollectibleFilterOptions {
  const merchants = new Map<string, string>();
  const themes = new Set<string>();
  const grades = new Map<string, string>();
  for (const group of groups) {
    merchants.set(group.merchantId, group.merchantName);
    themes.add(group.artwork.theme.name);
    grades.set(group.artwork.gradeId, group.artwork.gradeName);
  }
  for (const item of legacy) merchants.set(item.merchantId, item.merchantName);
  return {
    merchants: [...merchants.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    themes: [...themes].sort((a, b) => a.localeCompare(b, 'ko')),
    grades: [...grades.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  };
}

export type CollectibleFilter = { merchantId?: string; theme?: string; gradeId?: string };

export function filterCollectibleGroups(groups: readonly CollectibleGroup[], filter: CollectibleFilter): readonly CollectibleGroup[] {
  return groups.filter((group) =>
    (!filter.merchantId || group.merchantId === filter.merchantId)
    && (!filter.theme || group.artwork.theme.name === filter.theme)
    && (!filter.gradeId || group.artwork.gradeId === filter.gradeId));
}

/**
 * The store filter applied to legacy (no-picture) entitlements (#296 review): a legacy card has no theme/grade,
 * so an active theme or grade filter can never match one and it drops out, same as it would for any grouped
 * card that does not match.
 */
export function filterLegacyCollectibles(legacy: readonly UngroupedCollectible[], filter: CollectibleFilter): readonly UngroupedCollectible[] {
  if (filter.theme || filter.gradeId) return [];
  return legacy.filter((item) => !filter.merchantId || item.merchantId === filter.merchantId);
}

export type CollectibleSort = 'recent' | 'store' | 'grade';

export function sortCollectibleGroups(groups: readonly CollectibleGroup[], sort: CollectibleSort): readonly CollectibleGroup[] {
  const copy = [...groups];
  if (sort === 'store') return copy.sort((a, b) => a.merchantName.localeCompare(b.merchantName, 'ko'));
  if (sort === 'grade') return copy.sort((a, b) => a.artwork.gradeName.localeCompare(b.artwork.gradeName, 'ko'));
  return copy.sort((a, b) => (a.earnedDates[0]! < b.earnedDates[0]! ? 1 : -1));
}

/** One tile in the unified album grid: either a grouped (pictured) card or a legacy (no-picture) one. */
export type AlbumEntry =
  | { kind: 'group'; group: CollectibleGroup }
  | { kind: 'legacy'; item: UngroupedCollectible };

function albumMerchantName(entry: AlbumEntry): string {
  return entry.kind === 'group' ? entry.group.merchantName : entry.item.merchantName;
}

function albumEarnedDate(entry: AlbumEntry): string {
  return entry.kind === 'group' ? entry.group.earnedDates[0]! : entry.item.earnedAt;
}

function albumGradeName(entry: AlbumEntry): string {
  return entry.kind === 'group' ? entry.group.artwork.gradeName : '';
}

/**
 * The unified "내 수집 앨범" list — grouped and legacy collectibles filtered and sorted together (#296 review: the
 * old code appended `legacy` after `shown` unconditionally, so the store filter never hid other stores' legacy
 * cards and "newest first" only held within each half, not across the combined grid).
 */
export function filterAndSortAlbum(
  groups: readonly CollectibleGroup[],
  legacy: readonly UngroupedCollectible[],
  filter: CollectibleFilter,
  sort: CollectibleSort,
): readonly AlbumEntry[] {
  const entries: AlbumEntry[] = [
    ...filterCollectibleGroups(groups, filter).map((group): AlbumEntry => ({ kind: 'group', group })),
    ...filterLegacyCollectibles(legacy, filter).map((item): AlbumEntry => ({ kind: 'legacy', item })),
  ];
  if (sort === 'store') return entries.sort((a, b) => albumMerchantName(a).localeCompare(albumMerchantName(b), 'ko'));
  if (sort === 'grade') return entries.sort((a, b) => albumGradeName(a).localeCompare(albumGradeName(b), 'ko'));
  return entries.sort((a, b) => (albumEarnedDate(a) < albumEarnedDate(b) ? 1 : -1));
}
