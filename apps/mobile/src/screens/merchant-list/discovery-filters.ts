import type { BadgeBook } from '@/gamification/badge-api';
import type { MerchantFilterContext, MerchantFilters, ProgressFilter } from '@/merchant/apply-merchant-filters';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { merchantCategories, type MerchantCategory } from '@/merchant/merchant-categories';

import { buildMerchantGoals, buildStampSlots } from '../collection/collection-stamps';
import type { TownMapCollection } from '../town-map/town-pins';

// 탐색 목록의 필터 칩(Issue #331)이 쓰는 순수 규칙. 화면(index.tsx)은 이 결과를 그리기만 한다.

const progressLabels: Record<ProgressFilter, string> = {
  oneLeft: '보상까지 1번',
  unvisited: '안 가 본 곳',
  visited: '가 본 곳',
  coupon: '쿠폰 쓸 수 있는 곳',
};

/** 칩이 늘어서는 순서. */
const progressOrder: readonly ProgressFilter[] = ['oneLeft', 'unvisited', 'visited', 'coupon'];

export function progressChipLabel(progress: ProgressFilter): string {
  return progressLabels[progress];
}

/** 불러온 목록에 실제로 있는 업종만, 고정된 업종 순서로 한 번씩. 하나도 없으면 고를 것이 없으니 빈 배열이다. */
export function categoryChipOptions(merchants: readonly Pick<PublicMerchant, 'category'>[]): readonly MerchantCategory[] {
  const present = new Set(merchants.map((merchant) => merchant.category));
  return merchantCategories.filter((category) => present.has(category));
}

/**
 * 로그인했고 그 칩이 읽는 데이터를 불러왔을 때만 보인다. 방문 칩 셋은 /collection, 쿠폰 칩은 배지 책이 있어야 한다:
 * 데이터가 없는 칩을 눌러 "없음"을 보여 주면 아직 못 불러온 것을 없는 것으로 오해하게 하기 때문이다.
 */
export function progressChipOptions(state: { signedIn: boolean; collectionReady: boolean; badgesReady: boolean }): readonly ProgressFilter[] {
  if (!state.signedIn) return [];
  return progressOrder.filter((progress) => progress === 'coupon' ? state.badgesReady : state.collectionReady);
}

/** 이미 고른 진행 칩을 다시 누르면 꺼지고, 다른 칩을 누르면 바뀐다(진행 필터는 하나만 켠다). */
export function toggleProgress(current: ProgressFilter | null, next: ProgressFilter): ProgressFilter | null {
  return current === next ? null : next;
}

/**
 * 칩이 사라진 선택(로그아웃, 새로고침으로 목록에서 빠진 업종)은 "전체"로 되돌린다. 보이지 않는 칩이 걸러 낸 채로 남아
 * 결과가 왜 비었는지 알 수 없게 되는 것을 막는다. 검색어는 그대로 둔다.
 */
export function keepAvailableFilters(
  filters: MerchantFilters,
  available: { categories: readonly MerchantCategory[]; progressOptions: readonly ProgressFilter[] },
): MerchantFilters {
  const category = filters.category !== null && available.categories.includes(filters.category) ? filters.category : null;
  const progress = filters.progress !== null && available.progressOptions.includes(filters.progress) ? filters.progress : null;
  if (category === filters.category && progress === filters.progress) return filters;
  return { ...filters, category, progress };
}

/** 아직 쓰지 않은(ISSUED) 쿠폰이고 기한이 지나지 않은 것을 쥔 가게. 서버가 상태를 EXPIRED로 바꾸기 전의 만료 쿠폰은 뺀다. */
export function couponMerchantIds(book: Pick<BadgeBook, 'rewards'> | undefined, now: string): ReadonlySet<string> {
  const time = Date.parse(now);
  const ids = new Set<string>();
  for (const reward of book?.rewards ?? []) {
    const { coupon } = reward;
    if (coupon && coupon.status === 'ISSUED' && Date.parse(coupon.expiresAt) > time) ids.add(coupon.merchantId);
  }
  return ids;
}

/** 도감·지도와 같은 목표·도장 모델로 진행 필터가 읽을 데이터를 만든다. 아직 못 불러온 쪽은 비워 둔다(짐작하지 않는다). */
export function buildFilterContext(input: {
  merchants: readonly PublicMerchant[];
  collection: TownMapCollection | undefined;
  book: Pick<BadgeBook, 'rewards'> | undefined;
  now: string;
}): MerchantFilterContext {
  const { merchants, collection, book, now } = input;
  return {
    goalsByMerchant: collection
      ? new Map(buildMerchantGoals(merchants, collection.visits, collection.collectibles, now).map((goal) => [goal.merchantId, goal]))
      : new Map(),
    visitedMerchantIds: collection
      ? new Set(buildStampSlots(merchants, collection.visits).filter((slot) => slot.visited).map((slot) => slot.merchantId))
      : new Set(),
    couponMerchantIds: couponMerchantIds(book, now),
  };
}

/** "검색어 “김밥” · 한식 · 안 가 본 곳". 켜진 것이 없으면 빈 문자열. */
export function describeActiveFilters(filters: MerchantFilters): string {
  const query = filters.query.trim();
  return [
    query ? `검색어 “${query}”` : null,
    filters.category,
    filters.progress ? progressLabels[filters.progress] : null,
  ].filter((part): part is string => part !== null).join(' · ');
}

export function emptyFilterCopy(filters: MerchantFilters): { title: string; body: string; actionLabel: string } {
  return {
    title: '조건에 맞는 가게가 없어요',
    body: `지금 적용 중인 조건: ${describeActiveFilters(filters)}. 조건을 줄이거나 지워 보세요.`,
    actionLabel: '필터 지우기',
  };
}
