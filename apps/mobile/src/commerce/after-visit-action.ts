import type { Recommendation } from '@/recommendation/recommendation-api';
import type { BadgeBook } from '@/gamification/badge-api';
import { firstReadyReward } from '@/gamification/badge-rules';

export function hasOpenableBox(book: Pick<BadgeBook, 'rewards'> | undefined): boolean {
  return firstReadyReward(book) !== undefined;
}

export type AfterVisitAction =
  | { kind: 'collectible'; label: '받은 수집품 열기' }
  | { kind: 'box'; label: '상자 열기' }
  | { kind: 'recommendation'; label: string; detail: string; merchantId: string }
  | { kind: 'collection'; label: '도감 보기' };

/** 방문 뒤 한 가지 행동만 강조한다. 추천은 서버가 정한 순서의 첫 가게를 따른다. */
export function afterVisitAction(input: {
  hasUnopenedCollectible: boolean;
  hasOpenableBox: boolean;
  nextSuggestion?: Recommendation;
}): AfterVisitAction {
  if (input.hasUnopenedCollectible) return { kind: 'collectible', label: '받은 수집품 열기' };
  if (input.hasOpenableBox) return { kind: 'box', label: '상자 열기' };
  const suggestion = input.nextSuggestion;
  if (suggestion) {
    const nextReward = suggestion.nextGoal
      ? `${suggestion.nextGoal.displayName}까지 ${suggestion.nextGoal.remainingVisits}번`
      : '수집품 목표 완료';
    return { kind: 'recommendation', label: `다음 가볼 곳: ${suggestion.merchantName}`,
      detail: `${suggestion.reasonText} · ${nextReward}`, merchantId: suggestion.merchantId };
  }
  return { kind: 'collection', label: '도감 보기' };
}
