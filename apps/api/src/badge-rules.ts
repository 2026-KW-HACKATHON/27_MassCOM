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
export type CouponStoredStatus = 'ISSUED' | 'REDEEMED' | 'VOIDED';
// 고객에게 내려 보내는 쿠폰 상태. VOIDED는 절대 보내지 않는다: 이미 설치된 앱의 엄격한 파서가 모르는 상태를 거절해
// 도감 화면 전체가 깨진다. 무효 쿠폰은 아래 customerCouponView로 숨김·불가 상자·만료로 바꿔 보낸다.
export type CouponStatus = 'ISSUED' | 'REDEEMED' | 'EXPIRED';

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

// 저장 상태는 ISSUED/REDEEMED/VOIDED이고 만료는 응답에서만 파생한다. 무효 쿠폰은 customerCouponView가 따로 다룬다.
export function couponStatus(status: 'ISSUED' | 'REDEEMED', expiresAt: Date, now: Date): CouponStatus {
  return status === 'ISSUED' && expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : status;
}

// 방문 취소로 배지 조건이 깨져 무효가 된 쿠폰(VISIT_CANCELED)은 고객에게 숨기고 조건을 다시 채우면 되살린다.
// 관리자 무효화는 되살리지 않는다.
export const reissuableVoidReason = 'VISIT_CANCELED';

export function isReissuableVoid(coupon: { status: CouponStoredStatus; voidReason: string | null }): boolean {
  return coupon.status === 'VOIDED' && coupon.voidReason === reissuableVoidReason;
}

// 저장된 쿠폰을 고객 응답에서 어떻게 보일지.
// - SHOWN: 쿠폰으로 보낸다(status는 ISSUED·REDEEMED·EXPIRED만).
// - HIDDEN: 방문 취소로 무효가 됐고 아직 만료 전이라 응답에서 없는 것처럼 두고, 조건을 다시 채우면 되살린다.
// - UNAVAILABLE: 관리자가 무효로 했다. 쿠폰은 보내지 않고 상자를 열 수 없음(UNAVAILABLE, coupon null)으로 알린다.
// 방문 취소로 무효가 된 쿠폰의 원래 만료가 지났으면 되살리지 않고 만료된 쿠폰으로 보인다(되살리면 만료가 늘어난다).
export type CustomerCouponView =
  | { visibility: 'SHOWN'; status: CouponStatus }
  | { visibility: 'HIDDEN' }
  | { visibility: 'UNAVAILABLE' };

export function customerCouponView(
  coupon: { status: CouponStoredStatus; voidReason: string | null; expiresAt: Date },
  now: Date,
): CustomerCouponView {
  if (coupon.status !== 'VOIDED') return { visibility: 'SHOWN', status: couponStatus(coupon.status, coupon.expiresAt, now) };
  if (!isReissuableVoid(coupon)) return { visibility: 'UNAVAILABLE' };
  return coupon.expiresAt.getTime() <= now.getTime()
    ? { visibility: 'SHOWN', status: 'EXPIRED' }
    : { visibility: 'HIDDEN' };
}

const dayMs = 24 * 60 * 60 * 1000;
const kstOffsetMs = 9 * 60 * 60 * 1000;

// 클라이언트는 만료를 "~10월 29일까지"처럼 날짜로만 보여준다. 그래서 마지막 날은 발급일(한국 날짜)
// + 유효 일수째 날이고, 그날 23:59:59.999 KST까지 사용할 수 있게 한다. KST는 일광절약시간이 없다.
export function couponExpiry(issuedAt: Date, validDays: number): Date {
  const issueDayStart = Math.floor((issuedAt.getTime() + kstOffsetMs) / dayMs) * dayMs - kstOffsetMs;
  return new Date(issueDayStart + (validDays + 1) * dayMs - 1);
}
