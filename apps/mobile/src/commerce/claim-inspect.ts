import type { ClaimPreview } from './commerce-api';

export type AcceptedInspection = {
  preview: ClaimPreview;
  pendingRedeemToken: string;
  message: string;
};

/**
 * 코드 확인 응답을 화면에 반영할지 정한다. 응답을 기다리는 사이 입력이 바뀌어 요청이
 * 무효가 됐다면(`createIdentityRequestGate().isCurrent`가 false) 미리보기·확정 대상을 건드리지 않는다.
 */
export function acceptInspection(
  isCurrentRequest: boolean,
  code: string,
  preview: ClaimPreview,
): AcceptedInspection | undefined {
  if (!isCurrentRequest) return undefined;
  return {
    preview,
    pendingRedeemToken: code,
    message: preview.status === 'AVAILABLE'
      ? '사용 가능한 1회 코드입니다. 아래에서 수령을 확정하세요.'
      : '만료된 코드입니다.',
  };
}

/** 수령 확정이 보낼 코드. 지금 입력칸의 코드로 확인한 미리보기일 때만 그 코드를 돌려준다. */
export function redeemTarget(
  input: string,
  pendingRedeemToken: string | undefined,
  preview: ClaimPreview | undefined,
): string | undefined {
  if (!pendingRedeemToken || preview?.status !== 'AVAILABLE') return undefined;
  return pendingRedeemToken === input.trim() ? pendingRedeemToken : undefined;
}

export function selectedMerchantMismatch(selectedMerchantId: string | undefined, preview: ClaimPreview): boolean {
  return Boolean(selectedMerchantId && selectedMerchantId !== preview.merchantId);
}
