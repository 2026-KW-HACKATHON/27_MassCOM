import type { CouponStatus, Medal, RewardMilestone, RewardState } from './badge-rules.js';

export type BadgeRewardOffer = {
  merchantId: string;
  merchantName: string;
  title: string;
  detail: string;
  validDays: number;
};

export type BadgeCoupon = {
  couponId: string;
  milestone: RewardMilestone;
  merchantId: string;
  merchantName: string;
  title: string;
  detail: string;
  status: CouponStatus;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
};

// 상자를 열 수 없는 이유를 알리는 선택 필드의 값. 옛 앱·웹 파서는 모르는 필드를 무시하므로 더해도 깨지지 않는다.
export type BadgeRewardUnavailableReason = 'COUPON_REVOKED';

export type BadgeReward = {
  milestone: RewardMilestone;
  requiredTiers: number;
  state: RewardState;
  offer: BadgeRewardOffer | null;
  coupon: BadgeCoupon | null;
  // state가 UNAVAILABLE이고 관리자가 이 상자의 쿠폰을 무효로 했을 때만 있다(그 밖에는 필드 자체가 없다).
  unavailableReason?: BadgeRewardUnavailableReason;
};

export type BadgeSnapshot = {
  medals: Medal[];
  earnedTiers: number;
  rewards: BadgeReward[];
};

export type OpenedBadgeReward = { coupon: BadgeCoupon; replayed: boolean };

export type StaffCouponLookup = {
  identityExpiresAt: string;
  coupons: { couponId: string; title: string; detail: string; expiresAt: string }[];
};

export type RedeemedBadgeCoupon = {
  couponId: string;
  status: 'REDEEMED';
  redeemedAt: string;
  replayed: boolean;
};

export interface BadgeRewardService {
  getBadges(accountId: string): Promise<BadgeSnapshot>;
  openReward(input: { accountId: string; milestone: RewardMilestone }): Promise<OpenedBadgeReward>;
  lookupCoupons(input: {
    token: string;
    merchantId: string;
    staffAccountId: string;
  }): Promise<StaffCouponLookup>;
  redeemCoupon(input: {
    token: string;
    merchantId: string;
    staffAccountId: string;
    couponId: string;
  }): Promise<RedeemedBadgeCoupon>;
}

export type BadgeRewardErrorCode =
  | 'REWARD_LOCKED'
  | 'REWARD_OFFER_UNAVAILABLE'
  | 'REWARD_CAPACITY_EXHAUSTED'
  | 'COUPON_NOT_FOUND'
  | 'COUPON_EXPIRED'
  | 'COUPON_SELF_REDEEM'
  | 'COUPON_VOIDED'
  | 'ACCOUNT_DELETED';

export class BadgeRewardError extends Error {
  constructor(readonly code: BadgeRewardErrorCode) {
    super(code);
    this.name = 'BadgeRewardError';
  }
}
