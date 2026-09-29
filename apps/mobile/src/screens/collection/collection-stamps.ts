import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';

export type StampSlot = {
  merchantId: string;
  merchantName: string;
  visited: boolean;
  visitCount: number;
};

/** What the passport stamp page draws for one merchant; built from a slot and its goal by toPassportStamp. */
export type PassportStamp = {
  merchantId: string;
  name: string;
  visited: boolean;
  /** Short line under the stamp, e.g. how many visits are left for the next collectible. */
  goalText: string;
  /** Visit status line ("방문 2회"), shown next to the goal. */
  statusText: string;
  /** What the round stamp shows when there is no illustration: see stampGlyph. */
  glyph: string;
  /** The art path the owner chose for this merchant (`/merchant-art/<sha256>.webp`), or null; the stamp page draws it through the art bridge. */
  artUrl: string | null;
  /** What the slot is, read by screen readers: stamp state, visit status, progress and the full goal. The tap is the slot's hint. */
  label: string;
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

/** One short visible line for a stamp card; the full sentence stays in describeMerchantGoal. */
export function shortMerchantGoal(goal: MerchantGoal): string {
  if (!goal.totalGoals) return '보상 목표 없음';
  if (!goal.nextGoal) return '수집품 모두 모음';
  if (goal.campaignStatus === 'ended') return '캠페인 종료';
  if (goal.remainingVisits === 0) return '수집품 반영 중';
  if (goal.campaignStatus === 'upcoming') return '캠페인 시작 전';
  const participating = goal.progressCount > 0 || goal.earnedGoals.length > 0;
  if (goal.campaignStatus === 'full' && !participating) return '참여 정원 마감';
  return `수집품까지 ${goal.remainingVisits}번`;
}

/**
 * Text inside a round stamp when the merchant has no illustration. Demo stores all start with "가상", so the front of the name
 * told them apart poorly: use the last word when it is at most two characters ("가상 점포 A" -> "A"), else its first two.
 */
export function stampGlyph(name: string): string {
  const last = name.trim().split(/\s+/).at(-1) ?? '';
  if (!last) return '·';
  const characters = Array.from(last);
  return characters.length <= 2 ? last : characters.slice(0, 2).join('');
}

export function toPassportStamp(slot: StampSlot, goal: MerchantGoal, artUrl: string | null = null): PassportStamp {
  const statusText = slot.visited ? `방문 ${slot.visitCount}회` : '아직 안 가봤어요';
  const progressText = `보상 진행 ${goal.progressCount}${goal.nextGoal ? `/${goal.nextGoal.targetVisitCount}` : ''}회 · 앱 수집품 ${goal.earnedGoals.length}/${goal.totalGoals}`;
  // "도장 아직 없음" already says the visit status, so only a visited stamp adds the visit count.
  const stampState = slot.visited ? `${slot.merchantName} 도장 받음, ${statusText}` : `${slot.merchantName} 도장 아직 없음`;
  return {
    merchantId: slot.merchantId,
    name: slot.merchantName,
    visited: slot.visited,
    goalText: shortMerchantGoal(goal),
    statusText,
    glyph: stampGlyph(slot.merchantName),
    artUrl,
    label: `${stampState}, ${progressText}, ${describeMerchantGoal(goal)}`,
  };
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

const stampAngles = [-7, 5, -3, 8, -5, 3, -8, 6] as const;

/** Visited stamps lean a little, like real ink stamps; stable per slot position. */
export function stampRotation(index: number): number {
  return stampAngles[((index % stampAngles.length) + stampAngles.length) % stampAngles.length]!;
}
