import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

import type { StudioGoal, StudioSnapshot } from './studio-api';

const gameLabels = { stack: '타이밍 쌓기', memory: '짝 찾기', delivery: '세 갈래 배달', orders: '주문 맞추기' } as const;

type GoalMerchant = Pick<PublicMerchant, 'id' | 'name'> & {
  campaign: Pick<PublicMerchant['campaign'], 'id' | 'enrollmentStatus' | 'startsAt' | 'endsAt'> & { rewardGoals: readonly unknown[] };
};
type GoalCollection = {
  visits: readonly Pick<CollectionSnapshot['visits'][number], 'merchantId' | 'campaignId' | 'progressCounted'>[];
  collectibles: readonly Pick<CollectionSnapshot['collectibles'][number], 'merchantId' | 'campaignId' | 'targetVisitCount'>[];
};

export function studioGoalOptions(merchants: readonly GoalMerchant[], collection: GoalCollection,
  records: StudioSnapshot['records'], now = Date.now()) {
  const active = merchants.filter((merchant) => merchant.campaign.enrollmentStatus === 'OPEN'
    && Date.parse(merchant.campaign.startsAt) <= now && Date.parse(merchant.campaign.endsAt) > now);
  const options: { goal: NonNullable<StudioGoal>; label: string; progress: string; merchantId?: string }[] = [];
  for (const merchant of active) {
    const visits = collection.visits.filter((visit) => visit.merchantId === merchant.id
      && visit.campaignId === merchant.campaign.id && visit.progressCounted);
    const count = visits.length;
    if (!count) options.push({ goal: { kind: 'discover', merchantId: merchant.id }, label: `${merchant.name} 이번 캠페인 첫 방문`, progress: '방문 0/1', merchantId: merchant.id });
    if (count > 0 && count < 3) options.push({ goal: { kind: 'regular', merchantId: merchant.id }, label: `${merchant.name} 단골 되기`, progress: `방문 ${count}/3`, merchantId: merchant.id });
    const earned = new Set(collection.collectibles.filter((item) => item.merchantId === merchant.id
      && item.campaignId === merchant.campaign.id).map((item) => item.targetVisitCount)).size;
    const total = merchant.campaign.rewardGoals.length;
    if (total > 0 && earned < total) options.push({ goal: { kind: 'series', merchantId: merchant.id }, label: `${merchant.name} 시리즈 모으기`, progress: `수집 ${earned}/${total}`, merchantId: merchant.id });
  }
  for (const [gameKind, label] of Object.entries(gameLabels)) {
    const record = records.find((entry) => entry.kind === gameKind);
    options.push({ goal: { kind: 'play', gameKind }, label: `${label} 기록 도전`, progress: record ? `최고 ${record.bestScore}점 · ${record.plays}회` : '첫 플레이 기다리는 중' });
  }
  return options;
}
