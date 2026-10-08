import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';
import type { Recommendation } from '@/recommendation/recommendation-api';
import type { CoinShop } from '@/shop/coin-api';
import type { StudioSnapshot } from '@/studio/studio-api';

/** Each home request settles on its own, so a slow or failing one never holds back the rest of the screen. */
export type HomeSection = 'studio' | 'coins' | 'rewards' | 'collection' | 'merchants' | 'recommendations';
export const homeSectionNames: Record<HomeSection, string> = {
  studio: '마이룸', coins: '뽑기권', rewards: '방문 보상', collection: '도감', merchants: '가게', recommendations: '추천 가게',
};
export type HomeValues = {
  studio: StudioSnapshot; coins: CoinShop; rewards: number; collection: CollectionSnapshot;
  merchants: readonly PublicMerchant[]; recommendations: readonly Recommendation[];
};
const fields = { studio: 'studio', coins: 'coinShop', rewards: 'rewardCount', collection: 'collection', merchants: 'merchants', recommendations: 'recommendations' } as const;

export type HomeData = {
  loadedAt: number; studio?: StudioSnapshot; coinShop?: CoinShop; collection?: CollectionSnapshot;
  merchants?: readonly PublicMerchant[]; rewardCount?: number; recommendations?: readonly Recommendation[];
  /** Sections still waiting for their first answer. */
  pending: readonly HomeSection[];
  /** Sections whose latest request failed (a value from an earlier load may still be shown). */
  errors: readonly HomeSection[];
};

const firstLoad: readonly HomeSection[] = ['studio', 'coins', 'rewards', 'collection', 'merchants'];

/** Begin a load: sections that already have a value keep it on screen; the others show as loading. */
export function startHomeLoad(previous: HomeData | undefined, loadedAt: number): HomeData {
  const kept = previous ?? { loadedAt, pending: [], errors: [] };
  return { ...kept, loadedAt, errors: [], pending: firstLoad.filter((section) => kept[fields[section]] === undefined) };
}

export const markHomePending = (data: HomeData, section: HomeSection): HomeData =>
  data.pending.includes(section) ? data : { ...data, pending: [...data.pending, section] };

export function settleHomeSection<K extends HomeSection>(data: HomeData, section: K, outcome: { ok: true; value: HomeValues[K] } | { ok: false }): HomeData {
  const pending = data.pending.filter((item) => item !== section);
  const errors = data.errors.filter((item) => item !== section);
  return outcome.ok ? { ...data, [fields[section]]: outcome.value, pending, errors } : { ...data, pending, errors: [...errors, section] };
}

/**
 * "<마이룸·뽑기권> 조회 실패 · 다시 시도" text, or null when nothing failed. A failed recommendation is not reported: the catalog store
 * replaces it. Sections that are not on screen (the room before the first coin, 뽑기권 with no ticket in hand) are never named: the
 * person cannot see what failed there, and naming it would reveal the door Home keeps closed.
 */
export const homeErrorText = (errors: readonly HomeSection[], hidden: readonly HomeSection[] = []): string | null => {
  const shown = errors.filter((section) => section !== 'recommendations' && !hidden.includes(section));
  return shown.length ? `${shown.map((section) => homeSectionNames[section]).join('·')} 조회 실패 · 다시 시도` : null;
};

export type FirstStorePick = { merchantId: string; name: string; reason: string; source: 'recommendation' | 'catalog' };

/**
 * The one store to highlight for someone with no visit yet. The server's own recommendation comes first (a NEW_PLACE it already
 * ranks for this account); without one, the first store the public catalog says can be joined now. Null while the answer is
 * still on its way, so the card never shows one store and then swaps it.
 */
export function pickFirstStore(data: HomeData | undefined, goal: { merchantId: string; name: string } | null | undefined): FirstStorePick | null {
  if (!data?.collection || data.collection.visits.length > 0 || data.pending.includes('recommendations')) return null;
  const recommended = data.recommendations?.find((item) => item.reasonCode === 'NEW_PLACE' && item.enrollmentStatus === 'OPEN');
  if (recommended) return { merchantId: recommended.merchantId, name: recommended.merchantName, reason: recommended.reasonText, source: 'recommendation' };
  return goal ? { merchantId: goal.merchantId, name: goal.name, reason: '참여 중인 캠페인이 있는 가게예요.', source: 'catalog' } : null;
}

/**
 * Ask for a recommendation only for someone with no visit who has none yet. Coming back to the screen keeps the store already
 * shown, so the first-store card neither flickers nor swaps to another store.
 */
export const needsFirstStoreRecommendation = (visitCount: number, hasRecommendations: boolean): boolean => visitCount === 0 && !hasRecommendations;
