import type { MerchantOverview, VisitorFeedbackSummary } from './api';

export type OverviewCard = { label: string; value: string; comparison?: string; id?: string };

export function overviewCards(overview: MerchantOverview): OverviewCard[] {
  const comparison = overview.comparison;
  const cards: OverviewCard[] = [
    { label: '오늘 방문', value: String(overview.visits.today) },
    { label: '이번 주 방문', value: String(overview.visits.thisWeek),
      ...(comparison === null ? {} : { comparison: `지난주 같은 시간보다 ${comparison.delta > 0 ? '+' : ''}${comparison.delta}명` }) },
    { label: '재방문 고객', value: String(overview.repeatVisitors) },
  ];
  if (overview.weekVisitors) cards.push(
    // MassCOM에서 이 가게 방문이 처음 확인된 건수다. 앱 기록만으로는 평생 처음 온 손님인지 알 수 없다(D-092).
    { label: '이번 주 처음 확인된 방문', value: String(overview.weekVisitors.first) },
    { label: '이번 주 다시 확인된 방문', value: String(overview.weekVisitors.repeat) },
  );
  if (overview.weekCollectibles) {
    if (overview.weekCollectibles.length === 0) cards.push({ label: '이번 주 받은 수집품', value: '0' });
    else cards.push(...overview.weekCollectibles.map(({ gradeId, gradeName, count }) =>
      ({ id: `collectible-${gradeId}`, label: `이번 주 받은 수집품 · ${gradeName}`, value: String(count) })));
  }
  if (overview.weekCoupons) cards.push(
    { label: '이번 주 쿠폰 발급', value: String(overview.weekCoupons.issued) },
    { label: '이번 주 쿠폰 사용', value: String(overview.weekCoupons.redeemed) },
  );
  else cards.push({ label: '이번 주 쿠폰 사용', value: String(overview.couponsRedeemedThisWeek) });
  if (overview.weekDetailViews !== undefined) cards.push({ label: '이번 주 가게 상세 조회', value: String(overview.weekDetailViews) });
  return cards;
}

export function visitBars(overview: MerchantOverview) {
  const days = overview.visits.last7Days;
  const maximum = Math.max(1, ...days.map(({ count }) => count));
  return {
    summary: days.length ? `최근 7일 방문: ${days.map(({ date, count }) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 ${count}회`).join(', ')}` : '최근 7일 방문 기록이 없어요',
    days: days.map(({ date, count }) => ({ date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, count, heightPercent: count / maximum * 100 })),
  };
}

export function feedbackSections(summary: VisitorFeedbackSummary) {
  return {
    tags: summary.tags.map(({ label, count }) => ({ label, count })),
    suggestions: summary.suggestions.map(({ label, count }) => ({ label, count })),
    notes: summary.notes.map(({ customerLabel, date, text }) => ({ customerLabel, date, text })),
    empty: summary.tags.length === 0 && summary.suggestions.length === 0 && summary.notes.length === 0,
  };
}
