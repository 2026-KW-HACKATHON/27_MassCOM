import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

export function homeVisitGoal(merchants: readonly PublicMerchant[], collection: CollectionSnapshot, now: number) {
  const visits = collection.visits.filter((visit) => visit.progressCounted);
  const active = merchants.filter(({ campaign }) => Date.parse(campaign.startsAt) <= now && now < Date.parse(campaign.endsAt)
    && (campaign.enrollmentStatus === 'OPEN' || visits.some((visit) => visit.campaignId === campaign.id)));
  const latest = [...visits].sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    .map((visit) => active.find((merchant) => merchant.id === visit.merchantId && merchant.campaign.id === visit.campaignId))
    .find(Boolean);
  const merchant = latest ?? active[0];
  if (!merchant) return null;
  const count = visits.filter((visit) => visit.campaignId === merchant.campaign.id).length;
  const goals = merchant.campaign.rewardGoals.map((goal) => goal.targetVisitCount).sort((a, b) => a - b);
  return { merchantId: merchant.id, name: merchant.name, count, goals, next: goals.find((goal) => goal > count) ?? null };
}
