import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from './merchant-api';

export type ExplorationSummary = {
  weekStart: string;
  weekly: { current: number; target: number; completed: boolean; nextMerchantId?: string };
  series: { completed: number; total: number; nextMerchantId?: string };
};

const kstOffsetMs = 9 * 60 * 60 * 1000;

function kstWeek(now: Date): { today: string; weekStart: string } {
  const local = new Date(now.getTime() + kstOffsetMs);
  const today = local.toISOString().slice(0, 10);
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return { today, weekStart: monday.toISOString().slice(0, 10) };
}

/** Summary of visit opportunities backed only by the current public catalog and this account's collection. */
export function buildExplorationSummary(
  merchants: readonly PublicMerchant[],
  collection: CollectionSnapshot,
  now: Date,
): ExplorationSummary {
  const { today, weekStart } = kstWeek(now);
  const time = now.getTime();
  const countedVisits = collection.visits.filter((visit) => visit.progressCounted);
  const seenMerchantIds = new Set<string>();
  const eligible = merchants.filter((merchant) => {
    const { campaign } = merchant;
    if (time < Date.parse(campaign.startsAt) || time >= Date.parse(campaign.endsAt)) return false;
    const available = campaign.enrollmentStatus === 'OPEN' || countedVisits.some((visit) =>
      visit.merchantId === merchant.id && visit.campaignId === campaign.id);
    if (!available || seenMerchantIds.has(merchant.id)) return false;
    seenMerchantIds.add(merchant.id);
    return true;
  });
  const seenThisWeek = new Set(eligible.filter((merchant) => countedVisits.some((visit) =>
    visit.merchantId === merchant.id && visit.campaignId === merchant.campaign.id
    && visit.businessDate >= weekStart && visit.businessDate <= today)).map((merchant) => merchant.id));
  const target = Math.min(3, eligible.length);
  const current = seenThisWeek.size;
  const completed = target > 0 && current >= target;
  const nextWeekly = completed ? undefined : eligible
    .filter((merchant) => !seenThisWeek.has(merchant.id))
    .sort((a, b) => Number(countedVisits.some((visit) => visit.merchantId === a.id && visit.campaignId === a.campaign.id))
      - Number(countedVisits.some((visit) => visit.merchantId === b.id && visit.campaignId === b.campaign.id)))[0]?.id;

  let seriesCompleted = 0;
  let seriesTotal = 0;
  let nextSeries: string | undefined;
  for (const merchant of eligible) {
    const milestones = new Set(merchant.campaign.rewardGoals.map((goal) => goal.targetVisitCount));
    const owned = new Set(collection.collectibles.filter((item) =>
      item.merchantId === merchant.id && item.campaignId === merchant.campaign.id && item.appCollectibleStatus === 'COLLECTED')
      .map((item) => item.targetVisitCount));
    seriesTotal += milestones.size;
    for (const milestone of milestones) if (owned.has(milestone)) seriesCompleted++;
    if (!nextSeries && [...milestones].some((milestone) => !owned.has(milestone))) nextSeries = merchant.id;
  }
  return {
    weekStart,
    weekly: { current, target, completed, ...(nextWeekly ? { nextMerchantId: nextWeekly } : {}) },
    series: { completed: seriesCompleted, total: seriesTotal, ...(nextSeries ? { nextMerchantId: nextSeries } : {}) },
  };
}
