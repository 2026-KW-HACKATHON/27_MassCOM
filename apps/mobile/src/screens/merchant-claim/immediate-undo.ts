import type { RecentCouponRedemption, RedeemedCustomerCoupon } from '@/commerce/commerce-api';

/** 재전송 응답도 사용 시각까지 대조해 이번 사용만 정확히 연결한다. */
export function redeemedCouponTarget(result: RedeemedCustomerCoupon, recent: readonly RecentCouponRedemption[]): RecentCouponRedemption | undefined {
  return recent.find((coupon) => coupon.couponId === result.couponId
    && Date.parse(coupon.redeemedAt) === Date.parse(result.redeemedAt));
}

/** 서버 권한과 마감 시각을 모두 확인한다. 10분 경계부터 버튼을 숨긴다. */
export function canUndoNow(coupon: RecentCouponRedemption | undefined, now: number): boolean {
  return Boolean(coupon?.canUndo && now < Date.parse(coupon.undoUntil));
}

/** 사용 처리와 되돌리기는 렌더를 기다리지 않고 서로 중복 실행을 막는다. */
export function createCouponMutationGate() {
  let busy = false;
  return {
    isBusy: () => busy,
    acquire() { if (busy) return false; busy = true; return true; },
    release() { busy = false; },
  };
}
