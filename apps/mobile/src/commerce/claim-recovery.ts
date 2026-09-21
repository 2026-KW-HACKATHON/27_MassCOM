import { CommerceApiError, type ClaimPreview, type RedeemedClaim } from './commerce-api';

export function claimPreviewTitle(preview: ClaimPreview): string {
  return `${preview.merchantName} · ${preview.campaignTitle}`;
}

export function claimSuccessCopy(redeemed: RedeemedClaim) {
  return {
    title: redeemed.replayed
      ? `${redeemed.merchantName} 방문 결과 복구 완료`
      : `${redeemed.merchantName} 방문 인증 완료`,
    body: redeemed.replayed
      ? `이미 완료된 방문 결과를 복구했습니다. ${redeemed.campaignTitle} 진행 ${redeemed.visit.progressVisitCount}회를 확인했습니다.`
      : `${redeemed.campaignTitle} 진행 ${redeemed.visit.progressVisitCount}회를 확인했습니다.`,
    destinations: [
      { href: '/collection' as const, label: '내 도감 확인' },
      { href: '/recommendations' as const, label: '다음 가게 추천' },
    ],
  };
}

export function claimFailureAction(error: unknown, _preview: ClaimPreview) {
  if (error instanceof CommerceApiError && error.code === 'CLAIM_TOKEN_UNAVAILABLE') {
    return {
      kind: 'collection-check' as const,
      label: '내 도감에서 결과 확인' as const,
      message: '코드가 이미 처리됐을 수 있습니다. 도감을 새로 열어 방문 결과를 확인해 주세요.',
      keepPreview: true as const,
    };
  }
  if (!(error instanceof CommerceApiError)) {
    return {
      kind: 'retry' as const,
      label: '수령 결과 다시 확인' as const,
      message: '응답을 확인하지 못했습니다. 같은 코드를 다시 보내 기존 결과를 확인합니다.',
      keepPreview: true as const,
    };
  }
  return {
    kind: 'definitive' as const,
    label: '코드 상태 다시 확인' as const,
    message: claimApiMessage(error),
    keepPreview: false as const,
  };
}

export type ClaimRecoveryAction = ReturnType<typeof claimFailureAction>;

function claimApiMessage(error: CommerceApiError): string {
  const messages: Record<string, string> = {
    CLAIM_TOKEN_EXPIRED: '코드가 만료됐습니다. 점주에게 재발급을 요청해 주세요.',
    CLAIM_CAMPAIGN_UNAVAILABLE: '현재 수령 가능한 캠페인이 아닙니다. 코드는 소비되지 않았습니다.',
    ACCOUNT_AUTH_NOT_CONFIGURED: 'loopback 개발 계정 모드가 꺼져 있습니다.',
  };
  return messages[error.code] ?? `수령 실패: ${error.code}`;
}
