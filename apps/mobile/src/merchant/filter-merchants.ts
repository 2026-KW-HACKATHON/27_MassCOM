import type { PublicMerchant } from './merchant-api';

// 이름·소개·주소·캠페인 이름으로만 찾는다. 참여 상태로 거르지 않는다: 방문한 사람은 누구나 적립하고(D-023) 목록에는
// 기간 안의 캠페인만 오므로 모든 가게가 참여 가능하다.
export function filterMerchants(merchants: readonly PublicMerchant[], query: string): readonly PublicMerchant[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return merchants;
  return merchants.filter((merchant) => [merchant.name, merchant.story, merchant.roadAddress, merchant.campaign.title]
    .some((value) => value.toLocaleLowerCase().includes(needle)));
}
