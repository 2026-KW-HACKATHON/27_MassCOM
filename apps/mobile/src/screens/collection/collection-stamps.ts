import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

export type StampSlot = {
  merchantId: string;
  merchantName: string;
  visited: boolean;
  visitCount: number;
};

export type MerchantGoal = {
  merchantId: string;
  progressCount: number;
  earnedGoals: readonly number[];
  totalGoals: number;
  nextGoal: PublicMerchant['campaign']['rewardGoals'][number] | null;
  remainingVisits: number | null;
  campaignStatus: 'open' | 'upcoming' | 'ended' | 'full';
};

export function describeMerchantGoal(goal: MerchantGoal): string {
  const status = goal.campaignStatus === 'ended' ? '캠페인 종료'
    : goal.campaignStatus === 'full' ? '참여 정원 마감'
    : goal.campaignStatus === 'upcoming' ? '캠페인 시작 전' : '';
  const target = !goal.totalGoals ? '설정된 보상 목표 없음'
    : !goal.nextGoal ? '앱 수집품 목표 완료'
    : goal.remainingVisits === 0 ? '앱 수집품 반영 확인 중'
    : goal.campaignStatus === 'open'
      ? `다음 목표 ${goal.nextGoal.targetVisitCount}회 · ${goal.nextGoal.displayName} · ${goal.remainingVisits}회 남음`
      : `${goal.campaignStatus === 'upcoming' ? '예정 목표' : '미획득 목표'} ${goal.nextGoal.targetVisitCount}회 · ${goal.nextGoal.displayName}${goal.campaignStatus === 'full' && (goal.progressCount > 0 || goal.earnedGoals.length > 0) ? ` · 기존 참여자라면 ${goal.remainingVisits}회 남음` : ''}`;
  return status ? `${status} · ${target}` : target;
}

export function buildMerchantGoals(
  merchants: readonly Pick<PublicMerchant, 'id' | 'name' | 'campaign'>[],
  visits: readonly Pick<CollectionSnapshot['visits'][number], 'merchantId' | 'campaignId' | 'progressCounted'>[],
  collectibles: readonly Pick<CollectionSnapshot['collectibles'][number], 'merchantId' | 'campaignId' | 'targetVisitCount' | 'appCollectibleStatus'>[],
  now: string,
): readonly MerchantGoal[] {
  return merchants.map((merchant) => {
    const { campaign } = merchant;
    const progressCount = visits.filter((visit) =>
      visit.merchantId === merchant.id && visit.campaignId === campaign.id && visit.progressCounted).length;
    const earnedGoals = campaign.rewardGoals
      .filter((goal) => collectibles.some((item) =>
        item.merchantId === merchant.id && item.campaignId === campaign.id &&
        item.targetVisitCount === goal.targetVisitCount && item.appCollectibleStatus === 'COLLECTED'))
      .map((goal) => goal.targetVisitCount);
    const nextGoal = [...campaign.rewardGoals]
      .sort((a, b) => a.targetVisitCount - b.targetVisitCount)
      .find((goal) => !earnedGoals.includes(goal.targetVisitCount)) ?? null;
    const remainingVisits = nextGoal ? Math.max(0, nextGoal.targetVisitCount - progressCount) : null;
    const time = Date.parse(now);
    const campaignStatus = time >= Date.parse(campaign.endsAt) ? 'ended'
      : time < Date.parse(campaign.startsAt) ? 'upcoming'
      : campaign.enrollmentStatus === 'FULL' ? 'full' : 'open';
    return { merchantId: merchant.id, progressCount, earnedGoals, totalGoals: campaign.rewardGoals.length, nextGoal, remainingVisits, campaignStatus };
  });
}

/**
 * One stamp slot per public merchant, matched against the account's own
 * visits by merchant id (never by display name). Merchants the API does not
 * list are dropped; visits for a merchant id outside the current public
 * catalog are ignored rather than shown as a phantom slot.
 */
export function buildStampSlots(
  merchants: readonly Pick<PublicMerchant, 'id' | 'name'>[],
  visits: readonly { merchantId: string }[],
): readonly StampSlot[] {
  const visitCounts = new Map<string, number>();
  for (const visit of visits) {
    visitCounts.set(visit.merchantId, (visitCounts.get(visit.merchantId) ?? 0) + 1);
  }
  return merchants.map((merchant) => {
    const visitCount = visitCounts.get(merchant.id) ?? 0;
    return {
      merchantId: merchant.id,
      merchantName: merchant.name,
      visited: visitCount > 0,
      visitCount,
    };
  });
}

/** Columns shrink with the width that remains after system font scaling, so 200% text still fits. */
export function stampColumnCount(width: number, fontScale = 1): number {
  const effectiveWidth = width / Math.max(fontScale, 1);
  if (effectiveWidth < 220) return 1;
  return effectiveWidth < 340 ? 2 : 3;
}
