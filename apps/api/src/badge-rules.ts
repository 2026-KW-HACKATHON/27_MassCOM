// 탐험 여권 메달·보상 상자 규칙. 서버 계산이 정본이며 DB 접근 없이 시험할 수 있는 순수 함수만 둔다.

export const medalKinds = ['explorer', 'regular', 'steady'] as const;
export type MedalKind = (typeof medalKinds)[number];
export type MedalTier = 0 | 1 | 2 | 3;

// 브론즈·실버·골드 기준값.
export const medalThresholds: Record<MedalKind, readonly [number, number, number]> = {
  explorer: [1, 2, 3],
  regular: [2, 3, 5],
  steady: [2, 4, 7],
};

export type MedalValues = Record<MedalKind, number>;

export type Medal = {
  kind: MedalKind;
  value: number;
  tier: MedalTier;
  thresholds: readonly [number, number, number];
};

export const rewardMilestones = [
  { milestone: 1, requiredTiers: 3 },
  { milestone: 2, requiredTiers: 6 },
  { milestone: 3, requiredTiers: 9 },
] as const;
export type RewardMilestone = (typeof rewardMilestones)[number]['milestone'];

export type RewardState = 'LOCKED' | 'READY' | 'UNAVAILABLE' | 'OPENED';
export type CouponStoredStatus = 'ISSUED' | 'REDEEMED';
export type CouponStatus = CouponStoredStatus | 'EXPIRED';

export function isRewardMilestone(value: number): value is RewardMilestone {
  return value === 1 || value === 2 || value === 3;
}

export function tierFor(value: number, thresholds: readonly number[]): MedalTier {
  let tier = 0;
  for (const threshold of thresholds) if (value >= threshold) tier += 1;
  return tier as MedalTier;
}

export function buildMedals(values: MedalValues): Medal[] {
  return medalKinds.map((kind) => ({
    kind,
    value: values[kind],
    tier: tierFor(values[kind], medalThresholds[kind]),
    thresholds: medalThresholds[kind],
  }));
}

export function earnedTiers(medals: readonly Medal[]): number {
  return medals.reduce((sum, medal) => sum + medal.tier, 0);
}

export function offerHasCapacity(offer: { issuanceCap: number | null; issuedCount: number }): boolean {
  return offer.issuanceCap === null || offer.issuedCount < offer.issuanceCap;
}

export function rewardState(input: {
  requiredTiers: number;
  earnedTiers: number;
  offer: { issuanceCap: number | null; issuedCount: number } | null;
  hasCoupon: boolean;
}): RewardState {
  if (input.hasCoupon) return 'OPENED';
  if (input.earnedTiers < input.requiredTiers) return 'LOCKED';
  if (!input.offer || !offerHasCapacity(input.offer)) return 'UNAVAILABLE';
  return 'READY';
}

// 저장 상태는 ISSUED/REDEEMED뿐이고 만료는 응답에서만 파생한다.
export function couponStatus(status: CouponStoredStatus, expiresAt: Date, now: Date): CouponStatus {
  return status === 'ISSUED' && expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : status;
}

const dayMs = 24 * 60 * 60 * 1000;
const kstOffsetMs = 9 * 60 * 60 * 1000;

// 클라이언트는 만료를 "~10월 29일까지"처럼 날짜로만 보여준다. 그래서 마지막 날은 발급일(한국 날짜)
// + 유효 일수째 날이고, 그날 23:59:59.999 KST까지 사용할 수 있게 한다. KST는 일광절약시간이 없다.
export function couponExpiry(issuedAt: Date, validDays: number): Date {
  const issueDayStart = Math.floor((issuedAt.getTime() + kstOffsetMs) / dayMs) * dayMs - kstOffsetMs;
  return new Date(issueDayStart + (validDays + 1) * dayMs - 1);
}
