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

export type BadgeReward = {
  milestone: RewardMilestone;
  requiredTiers: number;
  state: RewardState;
  offer: BadgeRewardOffer | null;
  coupon: BadgeCoupon | null;
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
  | 'ACCOUNT_DELETED';

export class BadgeRewardError extends Error {
  constructor(readonly code: BadgeRewardErrorCode) {
    super(code);
    this.name = 'BadgeRewardError';
  }
}
