import type { CanceledVisit, RecentCouponRedemption, RecentVisit, UndoneCouponRedemption, VisitCancelReason } from '@/commerce/commerce-api';

// 직원 화면의 방문 취소·쿠폰 사용 되돌리기 문구와 순수 규칙(Issue #243). 화면은 이 값을 그대로 그린다.

export const visitCancelReasons: readonly { code: VisitCancelReason; label: string }[] = [
  { code: 'WRONG_CUSTOMER', label: '다른 손님으로 잘못 확인했어요' },
  { code: 'DUPLICATE', label: '같은 방문을 두 번 확인했어요' },
  { code: 'NOT_A_REAL_VISIT', label: '실제 방문·이용이 아니었어요' },
  { code: 'OTHER', label: '기타' },
];

export const reversalNoteMaxLength = 100;

const kstOffsetMs = 9 * 60 * 60 * 1000;

/** "12:05" — 한국 시간(KST는 일광절약시간이 없어 고정 +9시간). */
export function kstClockLabel(iso: string): string {
  const shifted = new Date(Date.parse(iso) + kstOffsetMs);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}`;
}

export function visitReasonLabel(code: string | null): string {
  return visitCancelReasons.find((reason) => reason.code === code)?.label ?? '사유 기록됨';
}

export function visitRowText(visit: RecentVisit): string {
  const status = visit.status === 'CANCELED'
    ? `취소됨 · ${visitReasonLabel(visit.cancellationReason)}`
    : visit.progressCounted ? '진행 반영' : '기록만(진행에 세지 않음)';
  return `${kstClockLabel(visit.occurredAt)} · ${visit.customerLabel} · ${status}`;
}

export function visitRowAccessibilityLabel(visit: RecentVisit): string {
  return `${kstClockLabel(visit.occurredAt)} ${visit.customerLabel} 방문 ${visitRowText(visit).split(' · ').slice(2).join(' ')}`;
}

export function redemptionRowText(coupon: RecentCouponRedemption): string {
  return `${coupon.title} · ${coupon.customerLabel} · ${kstClockLabel(coupon.redeemedAt)} 사용${coupon.redeemedByMe ? ' (내가 처리)' : ''}`;
}

// canUndo가 false인데 되돌리기 기한이 남아 있으면 시간 때문이 아니라 본인 쿠폰(실제 점포)이라서다.
export function undoHint(coupon: RecentCouponRedemption, now: Date = new Date()): string {
  if (coupon.canUndo) return `${kstClockLabel(coupon.undoUntil)}까지 되돌릴 수 있어요.`;
  return new Date(coupon.undoUntil).getTime() > now.getTime() ? '본인 쿠폰은 되돌릴 수 없어요.' : '되돌리기 시간이 지났어요.';
}

export function cancelConfirmText(visit: RecentVisit): string {
  return `${kstClockLabel(visit.occurredAt)} ${visit.customerLabel} 방문을 취소할까요?\n이 방문으로 받은 미전송 보상 권리는 함께 취소되고 조건이 깨진 미사용 쿠폰은 무효가 돼요.`;
}

export function undoConfirmText(coupon: RecentCouponRedemption): string {
  return `${coupon.title} · ${coupon.customerLabel}\n쿠폰 사용을 되돌릴까요? 고객이 다시 사용할 수 있게 돼요.`;
}

export function cancelSuccessMessage(result: CanceledVisit): string {
  const effects: string[] = [];
  if (result.revokedRewardCount > 0) effects.push(`보상 권리 ${result.revokedRewardCount}개 취소`);
  if (result.voidedCouponCount > 0) effects.push(`미사용 쿠폰 ${result.voidedCouponCount}장 무효`);
  return `${result.replayed ? '이미 취소된 방문이에요.' : '방문을 취소했어요.'}${effects.length ? ` (${effects.join(', ')})` : ''}`;
}

export function undoSuccessMessage(result: UndoneCouponRedemption): string {
  return result.replayed ? '이미 되돌린 쿠폰이에요.' : '쿠폰 사용을 되돌렸어요. 고객이 다시 사용할 수 있어요.';
}

/** 실패 뒤 목록이 낡았을 수 있어 새로 불러와야 하는 코드. */
export function staleAfterVisitFailure(code: string): boolean {
  return code === 'VISIT_CANCEL_WINDOW_CLOSED' || code === 'VISIT_NOT_FOUND';
}

export function staleAfterUndoFailure(code: string): boolean {
  return code === 'COUPON_UNDO_WINDOW_CLOSED' || code === 'COUPON_NOT_REDEEMED' || code === 'COUPON_NOT_FOUND'
    || code === 'COUPON_REQUIREMENT_LOST';
}

export function visitCancelFailureMessage(status: number | undefined, code: string): string {
  if (status === 401) return '점포 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  switch (code) {
    case 'MERCHANT_ACCESS_DENIED': return '이 점포의 방문 확인 권한이 없어요.';
    case 'VISIT_NOT_FOUND': return '이 점포에서 찾을 수 없는 방문이에요. 목록을 새로 불러왔어요.';
    case 'VISIT_CANCEL_WINDOW_CLOSED': return '방문한 날이 지나 취소할 수 없어요.';
    case 'VISIT_REWARD_ALREADY_MINTED': return '이 방문으로 받은 NFT를 이미 발행했거나 발행 중이라 취소할 수 없어요.';
    case 'VISIT_REWARD_MINT_IN_PROGRESS': return 'NFT 발행이 막 시작돼 지금은 취소할 수 없어요. 잠시 뒤 다시 시도해 주세요.';
    case 'INVALID_REVERSAL_REASON': return '취소 사유를 골라 주세요.';
    case 'INVALID_REVERSAL_NOTE': return '메모는 100자 이하로 쓰고 연락처·이메일·주소는 적지 마세요.';
    case 'ACCOUNT_DELETED': return '계정이 삭제돼 처리할 수 없어요.';
    default: return '방문을 취소하지 못했어요. 연결을 확인하고 잠시 후 다시 시도해 주세요.';
  }
}

export function undoFailureMessage(status: number | undefined, code: string): string {
  if (status === 401) return '점포 권한을 확인하지 못했어요. 다시 로그인해 주세요.';
  switch (code) {
    case 'MERCHANT_ACCESS_DENIED': return '이 점포의 쿠폰 처리 권한이 없어요.';
    case 'COUPON_NOT_FOUND': return '이 점포에서 찾을 수 없는 쿠폰이에요. 목록을 새로 불러왔어요.';
    case 'COUPON_UNDO_WINDOW_CLOSED': return '사용 처리 후 10분이 지나 되돌릴 수 없어요.';
    case 'COUPON_NOT_REDEEMED': return '사용 처리된 쿠폰이 아니라서 되돌릴 게 없어요.';
    case 'COUPON_SELF_UNDO': return '본인 쿠폰은 직접 되돌릴 수 없어요. 다른 직원에게 요청해 주세요.';
    case 'COUPON_REQUIREMENT_LOST': return '방문 기록이 바뀌어 고객의 배지 조건이 사라져서 되돌릴 수 없어요. 쿠폰은 사용 완료로 남아요.';
    case 'ACCOUNT_DELETED': return '계정이 삭제돼 처리할 수 없어요.';
    default: return '쿠폰 사용을 되돌리지 못했어요. 연결을 확인하고 잠시 후 다시 시도해 주세요.';
  }
}

export function listFailureMessage(status: number | undefined, code: string, what: '방문' | '쿠폰 사용'): string {
  if (status === 403 || code === 'MERCHANT_ACCESS_DENIED') return `이 점포의 최근 ${what} 목록을 볼 권한이 없어요.`;
  return `최근 ${what}을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.`;
}
