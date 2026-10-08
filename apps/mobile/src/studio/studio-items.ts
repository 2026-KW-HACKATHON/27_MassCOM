import type { CollectionSnapshot } from '@/commerce/commerce-api';

import type { StudioItem } from './studio-api';

/** A collected coin as the room draws it. Shared by the studio screen and the first-coin placement offer. */
export function itemFromCollection(item: CollectionSnapshot['collectibles'][number]): StudioItem {
  return {
    entitlementId: item.entitlementId, merchantId: item.merchantId, merchantName: item.merchantName,
    campaignTitle: item.campaignTitle, displayName: item.displayName, artwork: item.artwork,
  };
}
