const DAY_MS = 86_400_000;

// 종료는 정확한 시각으로 판정하고, 아직 남은 하루 미만은 1일로 안내한다.
// 날짜가 없거나 잘못된 응답은 기기 시계로 보완하지 않는다.
export function campaignTiming(endsAt, generatedAt) {
  const end = typeof endsAt === 'string' ? Date.parse(endsAt) : NaN;
  const now = typeof generatedAt === 'string' ? Date.parse(generatedAt) : NaN;
  if (!Number.isFinite(end) || !Number.isFinite(now)) return { daysLeft: null, ended: false, soon: false };
  const ended = end <= now;
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));
  return { daysLeft, ended, soon: !ended && daysLeft <= 14 };
}

export function orderedCampaigns(campaigns, generatedAt) {
  const rank = campaign => {
    const timing = campaignTiming(campaign.endsAt, generatedAt);
    return timing.soon ? 0 : timing.ended ? 1 : 2;
  };
  return [...campaigns].sort((a, b) => rank(a) - rank(b));
}

export function extendedCampaignEnd(endsAt, generatedAt, days) {
  if (![30, 90].includes(days) || campaignTiming(endsAt, generatedAt).daysLeft === null) return null;
  return new Date(Math.max(Date.parse(endsAt), Date.parse(generatedAt)) + days * DAY_MS).toISOString();
}

export function campaignEndingNotice(campaign, generatedAt) {
  if (!campaign) return '';
  const timing = campaignTiming(campaign.endsAt, generatedAt);
  if (timing.daysLeft === null) return '';
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(campaign.endsAt));
  const part = type => parts.find(item => item.type === type).value;
  const dateLabel = `${part('month')}월 ${part('day')}일`;
  if (timing.ended || ['ENDED', 'EXPIRED'].includes(campaign.phase)) {
    return `수집 캠페인이 ${dateLabel}에 끝났어요. 손님 앱의 가게 목록에서 내려갔어요. 계속하려면 운영자에게 연장을 요청해 주세요.`;
  }
  if (!timing.soon) return '';
  return `수집 캠페인이 ${timing.daysLeft}일 뒤(${dateLabel})에 끝나요. 끝나면 손님 앱의 가게 목록에서 내려가요. 계속하려면 운영자에게 연장을 요청해 주세요.`;
}
