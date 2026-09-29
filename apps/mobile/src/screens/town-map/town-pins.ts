import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

import { buildMerchantGoals, buildStampSlots, describeMerchantGoal, stampGlyph } from '../collection/collection-stamps';
import { assignAnchors } from './anchors';

/** What the map needs of a public merchant. */
export type TownMapMerchant = Pick<PublicMerchant, 'id' | 'name' | 'roadAddress' | 'demo' | 'campaign'>;

/** The part of the account's collection the map reads: recognised visits and earned collectibles. */
export type TownMapCollection = {
  visits: readonly Pick<CollectionSnapshot['visits'][number], 'merchantId' | 'campaignId' | 'progressCounted'>[];
  collectibles: readonly Pick<CollectionSnapshot['collectibles'][number], 'merchantId' | 'campaignId' | 'targetVisitCount' | 'appCollectibleStatus'>[];
};

/** Stamp state of one shop: 'unknown' while the collection is not loaded, never guessed as "not visited". */
export type StampStatus = 'visited' | 'none' | 'unknown';

export type TownPin = {
  merchantId: string;
  name: string;
  roadAddress: string;
  demo: boolean;
  /** The round mark when the shop has no illustration: the same short glyph as the passport stamp. */
  glyph: string;
  status: StampStatus;
  visitCount: number;
  /** Read by screen readers: "가게 이름, 도장 받음". */
  label: string;
  /** Visible line in the sheet: the stamp state. */
  statusLine: string;
  /** Visible line in the sheet: the next goal, absent when the stamp state is not known. */
  goalLine: string | null;
  /** The building (index into TOWN_MAP_ANCHORS); absent for shops that did not fit on the map. */
  slot?: number;
};

export type PlacedTownPin = TownPin & { slot: number };

export function pinLabel(name: string, status: StampStatus): string {
  const state = status === 'visited' ? '도장 받음' : status === 'none' ? '도장 아직 없음' : '도장 상태 확인 안 됨';
  return `${name}, ${state}`;
}

function statusLineFor(status: StampStatus, visitCount: number): string {
  if (status === 'visited') return `도장 받음 · 방문 ${visitCount}회`;
  return status === 'none' ? '아직 도장이 없어요' : '도장 상태를 확인하지 못했어요';
}

/**
 * One pin per public merchant, in the API's list order. Visits are matched by merchant id against the same stamp model the
 * passport uses (buildStampSlots), so a shop is "visited" here exactly when its stamp is in the 도감.
 * `collection` is undefined until the account's collection is loaded (or when it could not be).
 */
export function buildTownPins(
  merchants: readonly TownMapMerchant[],
  collection: TownMapCollection | undefined,
  now: string,
): { placed: readonly PlacedTownPin[]; overflow: readonly TownPin[] } {
  const slots = new Map(buildStampSlots(merchants, collection?.visits ?? []).map((slot) => [slot.merchantId, slot]));
  const goals = collection
    ? new Map(buildMerchantGoals(merchants, collection.visits, collection.collectibles, now).map((goal) => [goal.merchantId, goal]))
    : undefined;
  const { placed: anchorOf } = assignAnchors(merchants.map((merchant) => merchant.id));

  const pins = merchants.map((merchant): TownPin => {
    const slot = slots.get(merchant.id);
    const status: StampStatus = !collection ? 'unknown' : slot?.visited ? 'visited' : 'none';
    const visitCount = slot?.visitCount ?? 0;
    const goal = goals?.get(merchant.id);
    return {
      merchantId: merchant.id,
      name: merchant.name,
      roadAddress: merchant.roadAddress,
      demo: merchant.demo,
      glyph: stampGlyph(merchant.name),
      status,
      visitCount,
      label: pinLabel(merchant.name, status),
      statusLine: statusLineFor(status, visitCount),
      goalLine: goal ? describeMerchantGoal(goal) : null,
      slot: anchorOf.get(merchant.id),
    };
  });
  return {
    placed: pins.filter((pin): pin is PlacedTownPin => pin.slot !== undefined),
    overflow: pins.filter((pin) => pin.slot === undefined),
  };
}
