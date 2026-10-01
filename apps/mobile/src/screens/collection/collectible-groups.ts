import type { CollectibleArtwork } from '@/commerce/collectible-artwork';
import type { CollectionSnapshot } from '@/commerce/commerce-api';

type Collectible = Pick<
  CollectionSnapshot['collectibles'][number],
  'entitlementId' | 'merchantId' | 'merchantName' | 'artwork' | 'earnedAt'
>;

export type CollectibleGroup = {
  /** `${publicationId}:${gradeId}`: the same published picture, whichever campaign cycle granted it. */
  key: string;
  artwork: CollectibleArtwork;
  merchantId: string;
  merchantName: string;
  count: number;
  entitlementIds: readonly string[];
  /** ISO timestamps, most recent first. */
  earnedDates: readonly string[];
};

function groupKey(artwork: CollectibleArtwork): string {
  return `${artwork.publicationId}:${artwork.gradeId}`;
}

/**
 * Groups collectibles that carry the "다시 볼 수 있는" artwork by the published picture they show, so the same
 * publication earned twice (a repeated campaign cycle; a single entitlement per campaign goal is already enforced
 * server-side) reads as one card with a count, not two identical cards. Legacy collectibles without artwork are
 * dropped: they stay in the NFT-status list, which already handles them on their own.
 */
export function groupCollectibles(collectibles: readonly Collectible[]): readonly CollectibleGroup[] {
  const groups = new Map<string, CollectibleGroup>();
  for (const item of collectibles) {
    if (!item.artwork) continue;
    const key = groupKey(item.artwork);
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, {
        ...existing,
        count: existing.count + 1,
        entitlementIds: [...existing.entitlementIds, item.entitlementId],
        earnedDates: [...existing.earnedDates, item.earnedAt].sort().reverse(),
      });
    } else {
      groups.set(key, {
        key,
        artwork: item.artwork,
        merchantId: item.merchantId,
        merchantName: item.merchantName,
        count: 1,
        entitlementIds: [item.entitlementId],
        earnedDates: [item.earnedAt],
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.earnedDates[0]! < b.earnedDates[0]! ? 1 : -1));
}
