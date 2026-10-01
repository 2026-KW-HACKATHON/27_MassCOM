import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

export type SeriesSlot = {
  targetVisitCount: 1 | 3 | 5;
  displayName: string;
  owned: boolean;
  entitlementId?: string;
};

export type StoreSeries = {
  merchantId: string;
  merchantName: string;
  slots: readonly SeriesSlot[];
  completed: boolean;
  nextSlot: SeriesSlot | null;
};

type CollectibleLite = Pick<
  CollectionSnapshot['collectibles'][number],
  'entitlementId' | 'merchantId' | 'campaignId' | 'targetVisitCount' | 'appCollectibleStatus'
>;

/**
 * One series per merchant, its slots taken straight from the store's own campaign visit goals (17.2/17.4).
 * No new reward rule or probability is invented here: a slot is filled exactly when the account already holds a
 * collected entitlement for that goal, same as the passport stamp page's progress. Merchants without goals are
 * skipped — there is no series to show for them.
 */
export function buildStoreSeries(
  merchants: readonly Pick<PublicMerchant, 'id' | 'name' | 'campaign'>[],
  collectibles: readonly CollectibleLite[],
): readonly StoreSeries[] {
  return merchants
    .filter((merchant) => merchant.campaign.rewardGoals.length > 0)
    .map((merchant) => {
      const slots: SeriesSlot[] = [...merchant.campaign.rewardGoals]
        .sort((a, b) => a.targetVisitCount - b.targetVisitCount)
        .map((goal) => {
          const owned = collectibles.find((item) =>
            item.merchantId === merchant.id
            && item.campaignId === merchant.campaign.id
            && item.targetVisitCount === goal.targetVisitCount
            && item.appCollectibleStatus === 'COLLECTED');
          return { targetVisitCount: goal.targetVisitCount, displayName: goal.displayName, owned: !!owned, entitlementId: owned?.entitlementId };
        });
      return {
        merchantId: merchant.id,
        merchantName: merchant.name,
        slots,
        completed: slots.every((slot) => slot.owned),
        nextSlot: slots.find((slot) => !slot.owned) ?? null,
      };
    });
}

export function seriesSlotText(slot: SeriesSlot): string {
  return slot.owned ? `${slot.targetVisitCount}회 · ${slot.displayName}` : `${slot.targetVisitCount}회 방문하면 받아요`;
}
