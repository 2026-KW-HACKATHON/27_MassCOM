import type { HomeData } from './home-load';
import type { homeVisitGoal } from './visit-goal';
import { visibleHomeMerchantItems } from './showcase-visibility';
import { publicDataDemoStoreName } from '@/merchant/public-data-demo-store';

type VisitGoal = NonNullable<ReturnType<typeof homeVisitGoal>>;

export type HomeNextAction =
  | { kind: 'reward'; title: string; detail: string; href: '/home/tickets' }
  | { kind: 'coin-ticket'; title: string; detail: string; href: '/coin-shop' }
  | { kind: 'new-coin'; title: string; detail: string; href: '/coin-collection' }
  | { kind: 'new-collectible'; title: string; detail: string; href: '/collection' }
  | { kind: 'first-visit'; title: string; detail: string; href: '/search' }
  | { kind: 'next-visit'; title: string; detail: string; merchantId: string }
  | { kind: 'collection'; title: string; detail: string; href: '/collection' };

/** Decide only from responses known to be current; a missing higher-priority answer cannot mean zero. */
export function homeNextAction(data: HomeData | undefined, goal: VisitGoal | null | undefined, packageId?: string | null): HomeNextAction | null {
  if (!data || data.pending.includes('rewards') || data.rewardCount === undefined || data.errors.includes('rewards')) return null;
  if (data.rewardCount > 0) return { kind: 'reward', title: '도착한 방문 보상 열기', detail: `${data.rewardCount}개를 확인할 수 있어요`, href: '/home/tickets' };

  if (data.pending.includes('coins') || !data.coinShop || data.errors.includes('coins')) return null;
  const shop = data.coinShop;
  const validTickets = visibleHomeMerchantItems(shop.tickets, packageId).filter((ticket) => ticket.status === 'UNUSED' && Date.parse(ticket.expiresAt) > data.loadedAt
    && shop.pools.some((pool) => pool.id === ticket.poolId && pool.unavailableReason !== 'MEDIA_REMOVED'));
  if (validTickets.length) return { kind: 'coin-ticket', title: '가게 코인 뽑기권 사용하기', detail: `사용할 수 있는 뽑기권 ${validTickets.length}장`, href: '/coin-shop' };

  if (data.acquiredSinceLastView === 'coin') return { kind: 'new-coin', title: '새로 확인한 코인 보기', detail: '사용된 가게 코인 뽑기권의 결과를 도감에서 확인해요', href: '/coin-collection' };
  if (data.pending.includes('collection') || !data.collection || data.errors.includes('collection')) return null;
  if (data.acquiredSinceLastView === 'collectible') return { kind: 'new-collectible', title: '새 수집품 확인하기', detail: '방금 받은 방문 수집품을 도감에서 확인해요', href: '/collection' };
  if (data.collection.visits.length === 0) return { kind: 'first-visit', title: '첫 가게 찾아보기', detail: '방문할 가게와 조건을 확인해요', href: '/search' };

  if (data.pending.includes('merchants') || !data.merchants || data.errors.includes('merchants') || goal === undefined) return null;
  if (goal?.next) return { kind: 'next-visit', title: `${publicDataDemoStoreName(goal.merchantId, goal.name)} 다시 방문하기`, detail: `다음 방문 목표까지 ${goal.next - goal.count}회`, merchantId: goal.merchantId };
  return { kind: 'collection', title: '도감에서 수집 진행 보기', detail: '모은 수집품과 다음 목표를 확인해요', href: '/collection' };
}
