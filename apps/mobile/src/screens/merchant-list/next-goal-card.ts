import type { Recommendation } from '../../recommendation/recommendation-api';

/** 추천 순서는 서버가 정한다. 홈은 첫 항목 하나만 안내한다. */
export function homeNextGoalTitle(item: Recommendation): string {
  const goal = item.nextGoal;
  if (!goal) return `${item.merchantName} · 도감 완성`;
  if (item.progressVisitCount === 0) return `${item.merchantName} · 첫 도장 · ${goal.displayName}`;
  return `${item.merchantName} · ${goal.displayName}까지 ${goal.remainingVisits}번`;
}
