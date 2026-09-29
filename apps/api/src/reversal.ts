// 직원이 잘못 처리한 방문·쿠폰을 되돌리는 서비스 계약(Issue #243).
// 응답에는 고객 계정 ID·이메일을 싣지 않고 점포별로 다른 짧은 가림 표시만 싣는다.

export type RecentVisit = {
  visitEventId: string;
  occurredAt: string;
  customerLabel: string;
  status: 'VALID' | 'CANCELED';
  // 같은 날 두 번째 방문이나 직원 자기 적립은 기록만 되고 진행에 세지 않는다.
  progressCounted: boolean;
  cancellationReason: string | null;
  canCancel: boolean;
};

export type RecentVisits = { businessDate: string; visits: RecentVisit[] };

export type CancelVisitResult = {
  visitEventId: string;
  status: 'CANCELED';
  reason: string;
  note: string | null;
  canceledAt: string;
  revokedRewardCount: number;
  voidedCouponCount: number;
  replayed: boolean;
};

export type RecentCouponRedemption = {
  couponId: string;
  title: string;
  redeemedAt: string;
  customerLabel: string;
  redeemedByMe: boolean;
  undoUntil: string;
  canUndo: boolean;
};

export type UndoneCouponRedemption = {
  couponId: string;
  status: 'ISSUED';
  replayed: boolean;
};

export interface ReversalService {
  listRecentVisits(input: { merchantId: string; staffAccountId: string }): Promise<RecentVisits>;
  cancelVisit(input: {
    merchantId: string;
    staffAccountId: string;
    visitEventId: string;
    reason: unknown;
    note?: unknown;
  }): Promise<CancelVisitResult>;
  listRecentCouponRedemptions(input: {
    merchantId: string;
    staffAccountId: string;
  }): Promise<{ coupons: RecentCouponRedemption[] }>;
  undoCouponRedemption(input: {
    merchantId: string;
    staffAccountId: string;
    couponId: string;
  }): Promise<UndoneCouponRedemption>;
}

export type ReversalErrorCode =
  | 'INVALID_REVERSAL_REASON'
  | 'INVALID_REVERSAL_NOTE'
  | 'VISIT_NOT_FOUND'
  | 'VISIT_CANCEL_WINDOW_CLOSED'
  | 'VISIT_REWARD_ALREADY_MINTED'
  | 'VISIT_REWARD_MINT_IN_PROGRESS'
  | 'COUPON_NOT_FOUND'
  | 'COUPON_UNDO_WINDOW_CLOSED'
  | 'COUPON_NOT_REDEEMED'
  | 'COUPON_SELF_UNDO'
  | 'COUPON_REQUIREMENT_LOST'
  | 'ACCOUNT_DELETED';

export class ReversalError extends Error {
  constructor(readonly code: ReversalErrorCode) {
    super(code);
    this.name = 'ReversalError';
  }
}
