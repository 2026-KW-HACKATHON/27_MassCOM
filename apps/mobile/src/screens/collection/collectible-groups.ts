import type { CollectibleArtwork } from '@/commerce/collectible-artwork';
import type { CollectionSnapshot } from '@/commerce/commerce-api';

type RawCollectible = CollectionSnapshot['collectibles'][number];
type NftStatus = RawCollectible['nftStatus'];
type NftAsset = RawCollectible['nft'];

type Collectible = Pick<RawCollectible, 'entitlementId' | 'merchantId' | 'merchantName' | 'artwork' | 'earnedAt' | 'nftStatus' | 'nft' | 'recipient'>;

/** One entitlement's NFT status inside a (possibly grouped) collectible card; the mint action keys off this. */
export type CollectibleEntitlementStatus = {
  entitlementId: string;
  earnedAt: string;
  nftStatus: NftStatus;
  nft: NftAsset;
  recipient: string | null;
};

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
  /** Same order as `entitlementIds`: each earned copy keeps its own mint/NFT status, since duplicates can be at different stages. */
  entitlements: readonly CollectibleEntitlementStatus[];
};

function groupKey(artwork: CollectibleArtwork): string {
  return `${artwork.publicationId}:${artwork.gradeId}`;
}

function entitlementStatus(item: Collectible): CollectibleEntitlementStatus {
  return { entitlementId: item.entitlementId, earnedAt: item.earnedAt, nftStatus: item.nftStatus, nft: item.nft, recipient: item.recipient };
}

/**
 * Groups collectibles that carry the "다시 볼 수 있는" artwork by the published picture they show, so the same
 * publication earned twice (a repeated campaign cycle; a single entitlement per campaign goal is already enforced
 * server-side) reads as one card with a count, not two identical cards. Legacy collectibles without artwork are
 * dropped: `ungroupedCollectibles` below handles those.
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
        entitlements: [...existing.entitlements, entitlementStatus(item)],
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
        entitlements: [entitlementStatus(item)],
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.earnedDates[0]! < b.earnedDates[0]! ? 1 : -1));
}

type LegacyCollectible = Collectible & Pick<RawCollectible, 'displayName' | 'campaignTitle' | 'targetVisitCount'>;

/** A collectible with no published picture: still a real reward, shown in the album by name with its own NFT status. */
export type UngroupedCollectible = {
  entitlementId: string;
  merchantId: string;
  merchantName: string;
  displayName: string;
  campaignTitle: string;
  targetVisitCount: 1 | 3 | 5;
  earnedAt: string;
  nftStatus: NftStatus;
  nft: NftAsset;
  recipient: string | null;
};

/** The flip side of `groupCollectibles`: legacy entitlements without artwork, most recently earned first. */
export function ungroupedCollectibles(collectibles: readonly LegacyCollectible[]): readonly UngroupedCollectible[] {
  return collectibles
    .filter((item) => !item.artwork)
    .map((item) => ({
      entitlementId: item.entitlementId,
      merchantId: item.merchantId,
      merchantName: item.merchantName,
      displayName: item.displayName,
      campaignTitle: item.campaignTitle,
      targetVisitCount: item.targetVisitCount,
      earnedAt: item.earnedAt,
      nftStatus: item.nftStatus,
      nft: item.nft,
      recipient: item.recipient,
    }))
    .sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));
}
