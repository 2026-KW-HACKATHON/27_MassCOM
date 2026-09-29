import type { Recommendation } from '../../recommendation/recommendation-api';

export function reasonLabel(code: Recommendation['reasonCode']): string {
  if (code === 'NEW_PLACE') return '새로운 가게';
  if (code === 'NEXT_REWARD') return '다음 보상 가까움';
  return '도감 완성';
}

type CardRecommendation = Pick<
  Recommendation,
  'merchantName' | 'roadAddress' | 'demo' | 'progressVisitCount' | 'reasonCode' | 'reasonText'
> & { nextGoal?: Pick<NonNullable<Recommendation['nextGoal']>, 'targetVisitCount' | 'displayName'> };

/** Everything a recommendation card shows, in reading order: name, reason, address, progress and the next goal. */
export function recommendationLabel(item: CardRecommendation): string {
  return [
    item.merchantName,
    reasonLabel(item.reasonCode),
    item.demo ? '데모 데이터' : '',
    item.reasonText,
    item.roadAddress,
    `현재 ${item.progressVisitCount}회`,
    item.nextGoal ? `다음 ${item.nextGoal.targetVisitCount}회 ${item.nextGoal.displayName}` : '고정 보상 완료',
  ]
    .filter((part) => part.length > 0)
    .join(', ');
}

/** What tapping the card does; read after the label. */
export function recommendationHint(): string {
  return '가게 상세 보기';
}
