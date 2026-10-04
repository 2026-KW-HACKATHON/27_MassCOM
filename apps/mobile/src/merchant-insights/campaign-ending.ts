import { kstCalendarDay, kstParts } from '@/gamification/badge-rules';
import type { MerchantOverview } from './api';

type CampaignOverview = Pick<MerchantOverview, 'campaign'> & Partial<Pick<MerchantOverview, 'generatedAt'>>;

/** 가게 현황과 같은 시점의 캠페인 종료일을 안내한다. */
export function campaignEndingNotice(overview: CampaignOverview, now: number): string | null {
  const campaign = overview.campaign;
  if (!campaign) return null;

  const snapshotNow = overview.generatedAt ? Date.parse(overview.generatedAt) : now;
  const { month, day } = kstParts(campaign.endsAt);
  const ended = campaign.phase === 'ENDED' || campaign.phase === 'EXPIRED' || Date.parse(campaign.endsAt) <= snapshotNow;
  if (ended) {
    return `수집 캠페인이 ${month}월 ${day}일에 끝났어요. 손님 앱의 가게 목록에서 내려갔어요. 계속하려면 운영자에게 연장을 요청해 주세요.`;
  }

  const daysLeft = kstCalendarDay(campaign.endsAt) - kstCalendarDay(new Date(snapshotNow).toISOString());
  if (daysLeft > 14) return null;
  return `수집 캠페인이 ${daysLeft}일 뒤(${month}월 ${day}일)에 끝나요. 끝나면 손님 앱의 가게 목록에서 내려가요. 계속하려면 운영자에게 연장을 요청해 주세요.`;
}
