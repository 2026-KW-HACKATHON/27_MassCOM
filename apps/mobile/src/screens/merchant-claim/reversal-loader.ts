import {
  CommerceApiError,
  type CanceledVisit,
  type RecentCouponRedemption,
  type RecentVisit,
  type UndoneCouponRedemption,
  type VisitCancelReason,
} from '@/commerce/commerce-api';
import {
  cancelSuccessMessage,
  listFailureMessage,
  staleAfterUndoFailure,
  staleAfterVisitFailure,
  undoFailureMessage,
  undoSuccessMessage,
  visitCancelFailureMessage,
} from './reversal-copy';

// 직원 화면 "최근 방문 확인"·"최근 쿠폰 사용" 카드의 요청 장부(Issue #243). React 없이 시험할 수 있게 뺐다
// (friends-loader.ts와 같은 방식): 어떤 응답이 아직 화면에 들어갈 수 있는지, 처리 중 중복 누름을 어떻게 막는지,
// 점포가 바뀌면 이전 목록을 어떻게 지우는지를 한곳에 둔다.

export type ReversalApi = {
  listRecentVisits(merchantId: string): Promise<{ visits: readonly RecentVisit[] }>;
  listRecentCouponRedemptions(merchantId: string): Promise<readonly RecentCouponRedemption[]>;
  cancelVisit(input: { merchantId: string; visitEventId: string; reason: VisitCancelReason; note?: string }): Promise<CanceledVisit>;
  undoCouponRedemption(input: { merchantId: string; couponId: string }): Promise<UndoneCouponRedemption>;
};

export type ReversalState = {
  // 이 상태가 어느 점포의 것인지. 화면은 다른 점포의 상태를 그리지 않는다(점포가 바뀐 첫 렌더에 이전 목록이 비치지 않게).
  merchantId: string | undefined;
  visits: readonly RecentVisit[] | undefined;
  redemptions: readonly RecentCouponRedemption[] | undefined;
  visitMessage: string | undefined;
  redemptionMessage: string | undefined;
  busy: boolean;
};

const loadingVisits = '최근 방문을 불러오는 중이에요.';
const loadingRedemptions = '최근 쿠폰 사용을 불러오는 중이에요.';

/** 점포를 처음 열거나 바꿀 때의 화면: 이전 점포의 목록은 없고 "불러오는 중" 안내만 있다. */
export const initialReversalState: ReversalState = {
  merchantId: undefined,
  visits: undefined,
  redemptions: undefined,
  visitMessage: loadingVisits,
  redemptionMessage: loadingRedemptions,
  busy: false,
};

/** 새 목록을 읽은 뒤에도 남겨 둘 결과 안내(취소·되돌리기 성공 문구). */
export type KeepMessage = { visits?: boolean; redemptions?: boolean };

const errorStatus = (error: unknown) => (error instanceof CommerceApiError ? error.status : undefined);
const errorCode = (error: unknown) => (error instanceof CommerceApiError ? error.code : '');

export function createReversalController(
  api: ReversalApi,
  merchantId: string,
  applyToState: (update: (state: ReversalState) => ReversalState) => void,
) {
  // 가장 최근 읽기만 화면에 들어갈 수 있다. 화면이 닫히거나 점포가 바뀌면(dispose) 모든 응답이 낡은 것이다.
  let generation = 0;
  let disposed = false;
  // 렌더를 기다리지 않는 중복 누름 방지: 첫 누름이 끝날 때까지 다음 처리 요청은 서버로 가지 않는다.
  let busy = false;
  const apply = (update: (state: ReversalState) => ReversalState) => {
    if (!disposed) applyToState(update);
  };

  async function load(keep: KeepMessage = {}): Promise<void> {
    const current = ++generation;
    const [visitResult, redemptionResult] = await Promise.allSettled([
      api.listRecentVisits(merchantId),
      api.listRecentCouponRedemptions(merchantId),
    ]);
    if (current !== generation) return;
    apply((state) => {
      const next = { ...state };
      if (visitResult.status === 'fulfilled') {
        next.visits = visitResult.value.visits;
        if (!keep.visits) next.visitMessage = visitResult.value.visits.length ? undefined : '오늘 확인한 방문이 없어요.';
      } else {
        next.visits = undefined;
        next.visitMessage = listFailureMessage(errorStatus(visitResult.reason), errorCode(visitResult.reason), '방문');
      }
      if (redemptionResult.status === 'fulfilled') {
        next.redemptions = redemptionResult.value;
        if (!keep.redemptions) {
          next.redemptionMessage = redemptionResult.value.length ? undefined : '최근 24시간 안에 사용 처리한 쿠폰이 없어요.';
        }
      } else {
        next.redemptions = undefined;
        next.redemptionMessage = listFailureMessage(errorStatus(redemptionResult.reason), errorCode(redemptionResult.reason), '쿠폰 사용');
      }
      return next;
    });
  }

  return {
    /** 화면을 처음 열거나 점포가 바뀔 때: 이전 목록을 지우고 새로 읽는다. */
    start(): Promise<void> {
      apply(() => ({ ...initialReversalState, merchantId }));
      return load();
    },
    /** 새로 고침: 안내를 먼저 "불러오는 중"으로 바꾸고 읽는다. */
    refresh(): Promise<void> {
      apply((state) => ({ ...state, visitMessage: loadingVisits, redemptionMessage: loadingRedemptions }));
      return load();
    },
    isBusy: () => busy,
    /** 방문 취소. 서버가 받아들였을 때만 true를 돌려준다(호출한 쪽이 사유·메모 입력을 비운다). */
    async cancelVisit(visit: RecentVisit, input: { reason: VisitCancelReason; note: string }): Promise<boolean> {
      if (busy) return false;
      busy = true;
      apply((state) => ({ ...state, busy: true, visitMessage: '방문을 취소하는 중이에요.' }));
      try {
        const result = await api.cancelVisit({ merchantId, visitEventId: visit.visitEventId, ...input });
        apply((state) => ({ ...state, visitMessage: cancelSuccessMessage(result) }));
        await load({ visits: true });
        return true;
      } catch (error) {
        const code = errorCode(error);
        apply((state) => ({ ...state, visitMessage: visitCancelFailureMessage(errorStatus(error), code) }));
        if (staleAfterVisitFailure(code)) await load({ visits: true });
        return false;
      } finally {
        busy = false;
        apply((state) => ({ ...state, busy: false }));
      }
    },
    async undoCoupon(coupon: RecentCouponRedemption): Promise<boolean> {
      if (busy) return false;
      busy = true;
      apply((state) => ({ ...state, busy: true, redemptionMessage: '쿠폰 사용을 되돌리는 중이에요.' }));
      try {
        const result = await api.undoCouponRedemption({ merchantId, couponId: coupon.couponId });
        apply((state) => ({ ...state, redemptionMessage: undoSuccessMessage(result) }));
        await load({ redemptions: true });
        return true;
      } catch (error) {
        const code = errorCode(error);
        apply((state) => ({ ...state, redemptionMessage: undoFailureMessage(errorStatus(error), code) }));
        if (staleAfterUndoFailure(code)) await load({ redemptions: true });
        return false;
      } finally {
        busy = false;
        apply((state) => ({ ...state, busy: false }));
      }
    },
    /** 화면이 닫히거나 점포가 바뀜: 진행 중인 모든 응답을 버린다. */
    dispose(): void {
      disposed = true;
      generation += 1;
    },
  };
}
