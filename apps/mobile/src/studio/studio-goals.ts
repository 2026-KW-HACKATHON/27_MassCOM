import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

import type { StudioGoal, StudioSnapshot } from './studio-api';
import type { CollectiblePreview } from '@/merchant/collectible-preview-api';

const gameLabels = { stack: '타이밍 쌓기', memory: '짝 찾기', delivery: '세 갈래 배달', orders: '주문 맞추기' } as const;

type GoalMerchant = Pick<PublicMerchant, 'id' | 'name'> & {
  campaign: Pick<PublicMerchant['campaign'], 'id' | 'enrollmentStatus' | 'startsAt' | 'endsAt'> & { rewardGoals: readonly unknown[] };
};
type GoalCollection = {
  visits: readonly Pick<CollectionSnapshot['visits'][number], 'merchantId' | 'campaignId' | 'progressCounted'>[];
  collectibles: readonly (Pick<CollectionSnapshot['collectibles'][number], 'merchantId' | 'campaignId' | 'targetVisitCount'> &
    { publicationId?: string | null; artwork?: { publicationId: string } })[];
};

const activeCampaign = (merchant: GoalMerchant, now: number) => merchant.campaign.enrollmentStatus === 'OPEN'
  && Date.parse(merchant.campaign.startsAt) <= now && Date.parse(merchant.campaign.endsAt) > now;

export function studioGoalOptions(merchants: readonly GoalMerchant[], collection: GoalCollection,
  records: StudioSnapshot['records'], now = Date.now()) {
  const active = merchants.filter((merchant) => activeCampaign(merchant, now));
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
    const legacyPlays = Math.max(0, (record?.plays ?? 0) - (record?.version2Plays ?? 0));
    options.push({ goal: { kind: 'play', gameKind }, label: `${label} 기록 도전`, progress: record ? `${record.version2Plays ? `새 규칙 최고 ${record.version2BestScore ?? 0}점 · ${record.version2Plays}회` : '새 규칙 첫 플레이 기다리는 중'}${legacyPlays ? ` · 이전 규칙 ${record.bestScore}점 · ${legacyPlays}회` : ''}` : '첫 플레이 기다리는 중' });
  }
  return options;
}

/** Read-only resolution: a saved goal never implies that it is still eligible. */
export function resolveStudioGoal(goal: StudioGoal, merchants: readonly GoalMerchant[], collection: GoalCollection,
  now = Date.now(), preview?: Pick<CollectiblePreview, 'campaignId' | 'publicationId'> &
    { goals: readonly Pick<CollectiblePreview['goals'][number], 'visitCount'>[] }) {
  if (!goal) return undefined;
  const options = studioGoalOptions(merchants, collection, [], now);
  if (goal.kind === 'collectible') {
    const merchant = merchants.find((entry) => entry.id === goal.merchantId);
    const owned = collection.collectibles.some((item) => item.merchantId === goal.merchantId
      && item.campaignId === goal.campaignId && item.targetVisitCount === goal.targetVisitCount
      && (item.publicationId ?? item.artwork?.publicationId) === goal.publicationId);
    if (owned) return { goal, status: 'completed' as const, label: `${merchant?.name ?? '저장한 가게'} 목표 수집품을 획득했어요`, next: undefined };
    const available = merchant && Date.parse(merchant.campaign.startsAt) <= now && Date.parse(merchant.campaign.endsAt) > now
      && merchant.campaign.id === goal.campaignId
      && preview?.campaignId === goal.campaignId && preview.publicationId === goal.publicationId
      && preview.goals.some((item) => item.visitCount === goal.targetVisitCount);
    const visits = collection.visits.filter((item) => item.merchantId === goal.merchantId
      && item.campaignId === goal.campaignId && item.progressCounted).length;
    return { goal, status: available ? 'active' as const : 'unavailable' as const,
      label: available ? `${merchant.name} ${goal.targetVisitCount}회 방문 수집품 · 현재 ${visits}회${merchant.campaign.enrollmentStatus === 'FULL' ? ' · 신규 참여 마감, 기존 참여만 진행' : ''}` :
        `${merchant?.name ?? '저장한 가게'} 목표 수집품을 지금 받을 수 없어요. 현재 캠페인에서 다른 목표를 확인해 주세요`,
      next: available ? undefined : options.find((option) => option.merchantId) };
  }
  const selected = options.find((option) => option.goal.kind === goal.kind
    && option.goal.merchantId === goal.merchantId && option.goal.gameKind === goal.gameKind);
  if (selected) return { goal, status: 'active' as const, label: selected.label, next: undefined };
  const merchant = merchants.find((entry) => entry.id === goal.merchantId);
  const visits = merchant ? collection.visits.filter((entry) => entry.merchantId === merchant.id
    && entry.campaignId === merchant.campaign.id && entry.progressCounted).length : 0;
  const earned = merchant ? new Set(collection.collectibles.filter((entry) => entry.merchantId === merchant.id
    && entry.campaignId === merchant.campaign.id).map((entry) => entry.targetVisitCount)).size : 0;
  const completed = !!merchant && activeCampaign(merchant, now) && (goal.kind === 'discover' && visits >= 1
    || goal.kind === 'regular' && visits >= 3 || goal.kind === 'series' && merchant.campaign.rewardGoals.length > 0 && earned >= merchant.campaign.rewardGoals.length);
  return { goal, status: completed ? 'completed' as const : 'unavailable' as const,
    label: completed ? `${merchant!.name} 목표를 마쳤어요` : `${merchant?.name ?? '저장한 가게'} 목표를 지금 진행할 수 없어요`,
    next: options.find((option) => option.merchantId) };
}
