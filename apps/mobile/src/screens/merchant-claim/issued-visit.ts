import type { IssuedClaim, RecentVisit } from '@/commerce/commerce-api';

type IssuedReference = Pick<IssuedClaim, 'claimSlotId' | 'expiresAt'>;
export type VisitSelection = Pick<RecentVisit, 'claimSlotId' | 'visitEventId'>;
export type IssuedVisitState = { claim: IssuedReference; visit?: RecentVisit; failed?: boolean };

/** 방문 취소는 한국 영업일 안에만 가능하다. 코드가 자정을 넘기면 실제 수령일을 따른다. */
function cancelDeadline(at: string): number {
  const offset = 9 * 60 * 60 * 1000;
  return Math.floor((Date.parse(at) + offset) / 86400000) * 86400000 + 86400000 - offset;
}

export function issuedVisitNotice(state: IssuedVisitState | undefined, now: number) {
  if (!state || now >= cancelDeadline(state.visit?.occurredAt ?? state.claim.expiresAt)
    || state.visit?.status === 'CANCELED') return undefined;
  if (state.failed) return { kind: 'unknown' as const, canCancel: false, visit: undefined };
  if (!state.visit) return { kind: 'pending' as const, canCancel: false, visit: undefined };
  return { kind: 'confirmed' as const, canCancel: state.visit.canCancel, visit: state.visit };
}

/** 바로가기로 넘어와도 최신 목록에서 두 ID와 서버 권한을 다시 확인한다. */
export function preselectedCancelableVisit(visits: readonly RecentVisit[] | undefined, selection: VisitSelection | undefined, now: number) {
  return selection && visits?.find((visit) => visit.visitEventId === selection.visitEventId
    && visit.claimSlotId === selection.claimSlotId && visit.status === 'VALID' && visit.canCancel
    && now < cancelDeadline(visit.occurredAt));
}

type Timer = ReturnType<typeof setTimeout> | number;
type Clock = {
  now(): number;
  schedule(callback: () => void, delay: number): Timer;
  unschedule(timer: Timer): void;
};

/** 발급 참조만 보관한다. QR 토큰은 복사하지 않고, 다음 발급·점포·세션 변경의 낡은 읽기는 버린다. */
export function createIssuedVisitController(
  api: { listRecentVisits(merchantId: string): Promise<{ visits: readonly RecentVisit[] }> },
  merchantId: string,
  apply: (state: IssuedVisitState | undefined) => void,
  clock: Clock = { now: Date.now, schedule: setTimeout, unschedule: clearTimeout },
) {
  let state: IssuedVisitState | undefined;
  let generation = 0;
  let disposed = false;
  let timer: Timer | undefined;
  let polls = 0;
  const stopTimer = () => { if (timer !== undefined) clock.unschedule(timer); timer = undefined; };
  const publish = () => { if (!disposed) apply(state); };
  const clear = () => { generation += 1; stopTimer(); state = undefined; publish(); };

  async function refresh() {
    if (disposed || !state) return;
    if (!issuedVisitNotice(state, clock.now())) { clear(); return; }
    const current = ++generation;
    try {
      const result = await api.listRecentVisits(merchantId);
      if (disposed || current !== generation || !state) return;
      const visit = result.visits.find((row) => row.claimSlotId === state!.claim.claimSlotId);
      state = { claim: state.claim, visit: visit ?? state.visit };
      if (!issuedVisitNotice(state, clock.now())) { clear(); return; }
      if (state.visit) stopTimer();
    } catch {
      if (disposed || current !== generation || !state) return;
      state = { ...state, failed: true };
    }
    publish();
  }

  async function poll() {
    polls += 1;
    const claim = state?.claim;
    await refresh();
    if (!disposed && state?.claim === claim && !state?.visit && polls < 3) {
      timer = clock.schedule(() => { timer = undefined; void poll(); }, 3000);
    }
  }

  return {
    async issued(claim: IssuedReference) {
      if (disposed) return;
      clear();
      state = { claim: { claimSlotId: claim.claimSlotId, expiresAt: claim.expiresAt } };
      polls = 0;
      publish();
      await poll();
    },
    refresh,
    clear,
    dispose() { disposed = true; generation += 1; stopTimer(); },
  };
}
