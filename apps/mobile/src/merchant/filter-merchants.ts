import type { PublicMerchant } from './merchant-api';

export type MerchantAvailabilityFilter = 'all' | 'open';

export function filterMerchants(
  merchants: readonly PublicMerchant[],
  query: string,
  availability: MerchantAvailabilityFilter,
): readonly PublicMerchant[] {
  const needle = query.trim().toLocaleLowerCase();
  return merchants.filter((merchant) => {
    if (availability === 'open' && merchant.campaign.enrollmentStatus !== 'OPEN') return false;
    if (!needle) return true;
    return [merchant.name, merchant.story, merchant.roadAddress, merchant.campaign.title]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}
