import type { MerchantOverview, VisitorFeedbackSummary } from './api';

export type OverviewCard = { label: string; value: string; comparison?: string };

export function overviewCards(overview: MerchantOverview): OverviewCard[] {
  const comparison = overview.comparison;
  return [
    { label: '오늘 방문', value: String(overview.visits.today) },
    { label: '이번 주 방문', value: String(overview.visits.thisWeek),
      ...(comparison === null ? {} : { comparison: `지난주 같은 시간보다 ${comparison.delta > 0 ? '+' : ''}${comparison.delta}명` }) },
    { label: '재방문 고객', value: String(overview.repeatVisitors) },
    { label: '이번 주 쿠폰 사용', value: String(overview.couponsRedeemedThisWeek) },
  ];
}

export function feedbackSections(summary: VisitorFeedbackSummary) {
  return {
    tags: summary.tags.map(({ label, count }) => ({ label, count })),
    suggestions: summary.suggestions.map(({ label, count }) => ({ label, count })),
    notes: summary.notes.map(({ customerLabel, date, text }) => ({ customerLabel, date, text })),
    empty: summary.tags.length === 0 && summary.suggestions.length === 0 && summary.notes.length === 0,
  };
}
