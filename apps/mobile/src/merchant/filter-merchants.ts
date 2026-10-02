import { applyMerchantFilters } from './apply-merchant-filters';
import type { PublicMerchant } from './merchant-api';

// 검색어만으로 거르는 얇은 진입점이다(업종·진행 필터는 applyMerchantFilters). 참여 상태로 거르지 않는다: 방문한 사람은
// 누구나 적립하고(D-023) 목록에는 기간 안의 캠페인만 오므로 모든 가게가 참여 가능하다.
export function filterMerchants(merchants: readonly PublicMerchant[], query: string): readonly PublicMerchant[] {
  return applyMerchantFilters(merchants, { query, category: null, progress: null });
}
