import { isWithinWindows, type CampaignPurpose, type TimeWindow } from './campaign-purpose-rules.js';
import { composeOfferConsentNote } from './store-go-live-rules.js';

export type BenefitVisit = {
  id: string;
  campaignId: string;
  businessDate: string;
  slotCreatedAt: Date;
  occurredAt?: Date;
};

export type BenefitPurpose = {
  purpose: CampaignPurpose;
  revisitMinDays: number;
  revisitWindowDays: number;
  timeWindows: TimeWindow[] | null;
};

const dayMs = 86_400_000;

function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / dayMs;
}

export function benefitEligibility(
  campaignId: string, purpose: BenefitPurpose | null, visits: readonly BenefitVisit[],
  period?: { startsAt: Date; endsAt: Date },
): { sourceVisitId: string; usableFrom: Date | null } | null {
  if (!purpose) return null;
  const inPeriod = (visit: BenefitVisit) => !period || (visit.occurredAt !== undefined &&
    visit.occurredAt >= period.startsAt && visit.occurredAt < period.endsAt);
  const inCampaign = visits.filter(visit => visit.campaignId === campaignId && inPeriod(visit));
  if (purpose.purpose === 'NEW_CUSTOMERS') {
    const first = visits[0];
    return first?.campaignId === campaignId && inPeriod(first) ? { sourceVisitId: first.id, usableFrom: null } : null;
  }
  if (purpose.purpose === 'OFF_PEAK') {
    const source = inCampaign.findLast(visit =>
      purpose.timeWindows !== null && isWithinWindows(visit.slotCreatedAt, purpose.timeWindows));
    return source ? { sourceVisitId: source.id, usableFrom: null } : null;
  }
  const anchor = inCampaign[0];
  if (!anchor) return null;
  const firstDay = dayNumber(anchor.businessDate);
  const source = inCampaign.findLast(visit => {
    const elapsed = dayNumber(visit.businessDate) - firstDay;
    return elapsed >= purpose.revisitMinDays && elapsed <= purpose.revisitWindowDays;
  });
  return source ? {
    sourceVisitId: source.id,
    usableFrom: new Date((dayNumber(source.businessDate) + purpose.revisitMinDays) * dayMs - 9 * 3_600_000),
  } : null;
}

export function benefitCosts(
  counts: { redeemed: number; usable: number; maxUses: number; unitExtraCostWon: number },
): { costBorne: string; maxExposure: string; promisedMaxCost: string } {
  const unit = BigInt(counts.unitExtraCostWon);
  return {
    costBorne: (BigInt(counts.redeemed) * unit).toString(),
    maxExposure: (BigInt(counts.maxUses) * unit).toString(),
    promisedMaxCost: (BigInt(counts.redeemed + counts.usable) * unit).toString(),
  };
}

export function composeBenefitConsentNote(reference: string, unitExtraCostWon: number, maxUses: number): string {
  const exposure = BigInt(unitExtraCostWon) * BigInt(maxUses);
  return composeOfferConsentNote(reference) +
    ` · 건당 추가 원가 ${unitExtraCostWon.toLocaleString('ko-KR')}원` +
    ` · 발급 상한 ${maxUses.toLocaleString('ko-KR')}건` +
    ` · 최대 추가 원가 ${exposure.toLocaleString('ko-KR')}원`;
}
