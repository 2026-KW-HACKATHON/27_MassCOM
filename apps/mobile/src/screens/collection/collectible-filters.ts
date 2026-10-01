import type { CollectibleGroup } from './collectible-groups';

export type CollectibleFilterOptions = {
  merchants: readonly { id: string; name: string }[];
  themes: readonly string[];
  grades: readonly { id: string; name: string }[];
};

/** Distinct store / season(theme) / grade choices, built only from what the account actually owns. */
export function collectibleFilterOptions(groups: readonly CollectibleGroup[]): CollectibleFilterOptions {
  const merchants = new Map<string, string>();
  const themes = new Set<string>();
  const grades = new Map<string, string>();
  for (const group of groups) {
    merchants.set(group.merchantId, group.merchantName);
    themes.add(group.artwork.theme.name);
    grades.set(group.artwork.gradeId, group.artwork.gradeName);
  }
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

export type CollectibleSort = 'recent' | 'store' | 'grade';

export function sortCollectibleGroups(groups: readonly CollectibleGroup[], sort: CollectibleSort): readonly CollectibleGroup[] {
  const copy = [...groups];
  if (sort === 'store') return copy.sort((a, b) => a.merchantName.localeCompare(b.merchantName, 'ko'));
  if (sort === 'grade') return copy.sort((a, b) => a.artwork.gradeName.localeCompare(b.artwork.gradeName, 'ko'));
  return copy.sort((a, b) => (a.earnedDates[0]! < b.earnedDates[0]! ? 1 : -1));
}
