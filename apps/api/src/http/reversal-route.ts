import type { IncomingMessage } from 'node:http';

import type { ReversalService } from '../reversal.js';
import { decodePathParameter, readJson, requireEmptyBody } from './request-body.js';
import { RequestError } from './request-error.js';

export type ReversalRoute =
  | { kind: 'recent-visits' | 'recent-coupons'; merchantId: string }
  | { kind: 'cancel-visit'; merchantId: string; visitId: string }
  | { kind: 'undo-coupon'; merchantId: string; couponId: string };

// 방문 취소·쿠폰 사용 되돌리기 경로표(앱과 점주 웹이 접두사만 다르다). 알 수 없는 경로·메서드는 undefined라 다른 경로처럼 처리된다.
// ID는 아직 디코딩하지 않은 값이고 권한을 확인한 뒤에 디코딩한다.
export function matchReversalRoute(method: string | undefined, path: string, prefix: string): ReversalRoute | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const parts = path.slice(prefix.length).split('/');
  const [merchantId, first, second, third] = parts;
  if (!merchantId) return undefined;
  if (parts.length === 2 && method === 'GET') {
    if (first === 'recent-visits') return { kind: 'recent-visits', merchantId };
    if (first === 'recent-coupon-redemptions') return { kind: 'recent-coupons', merchantId };
  }
  if (parts.length === 4 && method === 'POST' && second) {
    if (first === 'visits' && third === 'cancel') return { kind: 'cancel-visit', merchantId, visitId: second };
    if (first === 'coupons' && third === 'undo-redeem') return { kind: 'undo-coupon', merchantId, couponId: second };
  }
  return undefined;
}

export async function runReversalRoute(
  reversals: ReversalService,
  route: ReversalRoute,
  merchantId: string,
  staffAccountId: string,
  request: IncomingMessage,
): Promise<object> {
  switch (route.kind) {
    case 'recent-visits':
      return reversals.listRecentVisits({ merchantId, staffAccountId });
    case 'recent-coupons':
      return reversals.listRecentCouponRedemptions({ merchantId, staffAccountId });
    case 'cancel-visit': {
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'reason' && key !== 'note')) throw new RequestError(400, 'INVALID_REQUEST');
      return reversals.cancelVisit({
        merchantId, staffAccountId, visitEventId: decodePathParameter(route.visitId),
        reason: body.reason, note: body.note,
      });
    }
    case 'undo-coupon':
      requireEmptyBody(await readJson(request, true));
      return reversals.undoCouponRedemption({ merchantId, staffAccountId, couponId: decodePathParameter(route.couponId) });
  }
}
