import type { CollectionSnapshot } from '@/commerce/commerce-api';

import { groupCollectibles } from '../collectible-groups';
import type { StoreSeries } from '../store-series';

export type EnvelopeStage = 'idle' | 'tearing' | 'cards' | 'end';

export type EnvelopeCardStep = { stage: 'cards'; index: number } | { stage: 'end' };

/** Same shape groupCollectibles already takes for the 도감 grid; reused below instead of a second grouping rule. */
export type EnvelopeCollectibleLite = Pick<
  CollectionSnapshot['collectibles'][number],
  'entitlementId' | 'merchantId' | 'merchantName' | 'artwork' | 'earnedAt'
>;

/** Where the tear animation lands: straight to the end card when every load in the batch failed. */
export function startCards(total: number): EnvelopeCardStep {
  return total > 0 ? { stage: 'cards', index: 0 } : { stage: 'end' };
}

/**
 * Swiping or tapping through the cards. Past the last card lands on the end card; stepping backward from the end
 * card (or past the first card) lands on the nearest real card instead of leaving the flow — only the skip button
 * (and the end card's own buttons) actually closes the reveal.
 */
export function stepCard(current: EnvelopeCardStep, total: number, direction: 1 | -1): EnvelopeCardStep {
  if (total <= 0) return { stage: 'end' };
  // The end card sits one past the last card, so stepping back from it lands on the last card itself.
  const index = current.stage === 'cards' ? current.index : total;
  const next = index + direction;
  if (next >= total) return { stage: 'end' };
  if (next < 0) return { stage: 'cards', index: 0 };
  return { stage: 'cards', index: next };
}

/**
 * An entitlement is NEW when every entitlement the account holds of the same published picture+grade came from this
 * same batch — i.e. the account held none of this kind before this claim. groupCollectibles already keys collectibles
 * this way for the 도감 grid (`${publicationId}:${gradeId}`), so that grouping decides "first of its kind" here too
 * instead of a second definition that could drift from it.
 */
export function newEntitlementIds(
  batchIds: readonly string[],
  collectibles: readonly EnvelopeCollectibleLite[],
): ReadonlySet<string> {
  const batch = new Set(batchIds);
  const result = new Set<string>();
  for (const group of groupCollectibles(collectibles)) {
    if (group.entitlementIds.length > 0 && group.entitlementIds.every((id) => batch.has(id))) {
      for (const id of group.entitlementIds) result.add(id);
    }
  }
  return result;
}

/** Distinct published pictures (by groupCollectibles's own key) the account holds — a "종류" in "N종류 달성!". */
export function kindCount(collectibles: readonly EnvelopeCollectibleLite[]): number {
  return groupCollectibles(collectibles).length;
}

export type EnvelopeMilestone = { reached: true; count: number } | { reached: false };

// ponytail: fixed checkpoint list rather than a formula; add more thresholds here if the catalog grows past 200 kinds.
const MILESTONE_THRESHOLDS = [5, 10, 20, 30, 50, 100, 150, 200] as const;

/** Whether this batch's new kinds carried the account's total distinct-kind count across a checkpoint. */
export function milestoneForBatch(
  batchIds: readonly string[],
  collectibles: readonly EnvelopeCollectibleLite[],
): EnvelopeMilestone {
  const batch = new Set(batchIds);
  const beforeCount = kindCount(collectibles.filter((item) => !batch.has(item.entitlementId)));
  const afterCount = kindCount(collectibles);
  const crossed = MILESTONE_THRESHOLDS.filter((threshold) => beforeCount < threshold && afterCount >= threshold);
  const count = crossed.at(-1);
  return count === undefined ? { reached: false } : { reached: true, count };
}

/** The one store series this batch belongs to (every entitlement in a single claim comes from the same visit/merchant). */
export function seriesForBatch(
  series: readonly StoreSeries[],
  collectibles: readonly EnvelopeCollectibleLite[],
  batchIds: readonly string[],
): StoreSeries | undefined {
  const merchantId = collectibles.find((item) => batchIds.includes(item.entitlementId))?.merchantId;
  return merchantId === undefined ? undefined : series.find((item) => item.merchantId === merchantId);
}
