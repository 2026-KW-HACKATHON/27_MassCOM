import type { MerchantGoal } from '../screens/collection/collection-stamps';
import type { MerchantCategory } from './merchant-categories';
import type { PublicMerchant } from './merchant-api';

/** 로그인한 계정의 진행 상황으로 거르는 칩. 하나만 고르거나 아무것도 고르지 않는다. */
export type ProgressFilter = 'oneLeft' | 'unvisited' | 'visited' | 'coupon';

export type MerchantFilters = {
  /** 이름·소개·주소·캠페인 이름·메뉴 이름에서 찾는다. 앞뒤 공백은 무시하고 대소문자는 구분하지 않는다. */
  query: string;
  /** null이면 전체. */
  category: MerchantCategory | null;
  progress: ProgressFilter | null;
};

/** 진행 필터가 읽는 계정 데이터. 가게 id로만 맞춘다(이름으로 맞추지 않는다). */
export type MerchantFilterContext = {
  /** 도감 화면과 같은 buildMerchantGoals의 결과를 가게 id로 찾을 수 있게 한 것. */
  goalsByMerchant: ReadonlyMap<string, Pick<MerchantGoal, 'remainingVisits' | 'campaignStatus'>>;
  /** 방문 기록이 한 줄이라도 있는 가게(도감 도장과 같은 기준). */
  visitedMerchantIds: ReadonlySet<string>;
  /** 아직 쓰지 않은(ISSUED, 기한 안) 쿠폰을 쥔 가게. */
  couponMerchantIds: ReadonlySet<string>;
};

export const EMPTY_FILTER_CONTEXT: MerchantFilterContext = {
  goalsByMerchant: new Map(),
  visitedMerchantIds: new Set(),
  couponMerchantIds: new Set(),
};

export function hasActiveFilters(filters: MerchantFilters): boolean {
  return filters.query.trim().length > 0 || filters.category !== null || filters.progress !== null;
}

function matchesQuery(merchant: PublicMerchant, needle: string): boolean {
  return [merchant.name, merchant.story, merchant.roadAddress, merchant.campaign.title, ...merchant.menuItems.map((item) => item.name)]
    .some((value) => value.toLocaleLowerCase().includes(needle));
}

function matchesProgress(merchant: PublicMerchant, progress: ProgressFilter, context: MerchantFilterContext): boolean {
  switch (progress) {
    case 'oneLeft': {
      // 도감이 "수집품까지 1번"이라고 보여 주는 가게만이다: 진행 중인 캠페인에서 다음 목표가 정확히 1번 남은 곳.
      const goal = context.goalsByMerchant.get(merchant.id);
      return goal?.campaignStatus === 'open' && goal.remainingVisits === 1;
    }
    case 'unvisited':
      return !context.visitedMerchantIds.has(merchant.id);
    case 'visited':
      return context.visitedMerchantIds.has(merchant.id);
    case 'coupon':
      return context.couponMerchantIds.has(merchant.id);
  }
}

/**
 * 탐색 목록의 검색어·업종·진행 필터를 한꺼번에 적용한다. 조건은 모두 AND이고 API가 준 순서를 지킨다. 아무 필터도 켜지 않으면
 * 받은 배열을 그대로 돌려준다. `context`가 없으면(로그아웃) 계정 데이터가 없는 것으로 읽는다.
 */
export function applyMerchantFilters(
  merchants: readonly PublicMerchant[],
  filters: MerchantFilters,
  context: MerchantFilterContext = EMPTY_FILTER_CONTEXT,
): readonly PublicMerchant[] {
  if (!hasActiveFilters(filters)) return merchants;
  const needle = filters.query.trim().toLocaleLowerCase();
  return merchants.filter((merchant) =>
    (!needle || matchesQuery(merchant, needle)) &&
    (filters.category === null || merchant.category === filters.category) &&
    (filters.progress === null || matchesProgress(merchant, filters.progress, context)));
}
