import type { CollectibleArtwork } from '@/commerce/collectible-artwork';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { kstParts } from '@/gamification/badge-rules';
import { isLargeText } from '@/ui/large-text';

type RawCollectible = CollectionSnapshot['collectibles'][number];
type NftStatus = RawCollectible['nftStatus'];
type NftAsset = RawCollectible['nft'];

// nftStatus/nft/recipient stay optional: PR #297/#299's envelope reveal groups a lighter collectible shape
// (entitlementId/merchantId/merchantName/artwork/earnedAt only, for NEW/kind-count purposes) through this same
// function instead of a second grouping rule, and never reads a group's `entitlements` field.
type Collectible = Pick<RawCollectible, 'entitlementId' | 'merchantId' | 'merchantName' | 'artwork' | 'earnedAt'>
  & Partial<Pick<RawCollectible, 'nftStatus' | 'nft' | 'recipient'>>;

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
  return {
    entitlementId: item.entitlementId,
    earnedAt: item.earnedAt,
    nftStatus: item.nftStatus ?? 'NOT_REQUESTED',
    nft: item.nft ?? null,
    recipient: item.recipient ?? null,
  };
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
      nftStatus: item.nftStatus ?? 'NOT_REQUESTED',
      nft: item.nft ?? null,
      recipient: item.recipient ?? null,
    }))
    .sort((a, b) => (a.earnedAt < b.earnedAt ? 1 : -1));
}

/** 받은 날짜는 한국 날짜로 보인다. UTC 날짜를 자르면 자정~오전 9시에 받은 수집품이 전날로 보인다. */
export function earnedDateLabel(iso: string): string {
  const { month, day } = kstParts(iso);
  return `${month}월 ${day}일`;
}

export const COLLECTION_GRID_GAP = 12;
/** 두 열 카드의 최소 폭. 이보다 좁으면 카드 안의 글자·단추가 접히므로 한 열로 넓게 둔다. */
export const MIN_TWO_COLUMN_CARD_WIDTH = 150;

/**
 * 격자의 실제 폭으로 카드 폭을 정한다. '48%'처럼 비율로 두면 좁은 화면(320dp)에서 두 장과 간격이 격자보다 넓어져
 * 한 줄에 한 장만 좁게 남는다. 큰 글씨(150% 이상)에서는 늘 한 열이다.
 */
export function collectionCardLayout(gridWidth: number, fontScale: number): { columns: 1 | 2; width: number } {
  const full = Math.max(0, Math.floor(gridWidth));
  const half = Math.floor((full - COLLECTION_GRID_GAP) / 2);
  if (isLargeText(fontScale) || half < MIN_TWO_COLUMN_CARD_WIDTH) return { columns: 1, width: full };
  return { columns: 2, width: half };
}
