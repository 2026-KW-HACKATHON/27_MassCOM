import type { PublicMerchant } from './merchant-api';

export type MerchantAvailabilityFilter = 'all' | 'open';

export function filterMerchants(
  merchants: readonly PublicMerchant[],
  query: string,
  availability: MerchantAvailabilityFilter,
): readonly PublicMerchant[] {
  const needle = query.trim().toLocaleLowerCase();
  // '참여 가능'(open)은 정원(enrollmentStatus)으로 거르지 않는다: 방문한 사람은 누구나 적립하고(D-023) 목록에는 기간 안의
  // 캠페인만 온다. 정원이 찬 가게도 카드에 "참여 가능"으로 보이므로 이 칩을 눌러도 사라지지 않아야 한다.
  void availability;
  return merchants.filter((merchant) => {
    if (!needle) return true;
    return [merchant.name, merchant.story, merchant.roadAddress, merchant.campaign.title]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });
}
