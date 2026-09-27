export type StatusAnnouncementKind =
  | 'login-restoring' | 'login-failed' | 'claim-preview' | 'claim-replayed'
  | 'collection-binding-outage' | 'polling-paused' | 'polling-recovered'
  | 'wallet-verified' | 'wallet-disconnected' | 'logout-complete'
  | 'account-switch-complete' | 'deletion-blocked';

export function statusAnnouncement(
  kind: StatusAnnouncementKind,
  context: Record<string, string> = {},
): string {
  const merchantName = context.merchantName ?? '음식점';
  const campaignTitle = context.campaignTitle ?? '캠페인';
  const copy: Record<StatusAnnouncementKind, string> = {
    'login-restoring': '저장된 로그인을 확인하는 중입니다.',
    'login-failed': loginFailureCopy(context.reason),
    'claim-preview': `${merchantName}의 ${campaignTitle} 방문 수령 내용을 확인했습니다.`,
    'claim-replayed': `${merchantName}에서 이미 완료된 방문 수령 결과를 복구했습니다.`,
    'collection-binding-outage': '앱 수집품은 표시하지만 외부 지갑 주소 확인 상태는 불러오지 못했습니다.',
    'polling-paused': 'NFT 등록 결과를 확인하지 못해 자동 확인을 멈췄습니다.',
    'polling-recovered': 'NFT 등록 결과를 다시 확인했습니다.',
    'wallet-verified': '외부 지갑 주소 확인을 완료했습니다.',
    'wallet-disconnected': '외부 지갑 연결을 해제했습니다.',
    'logout-complete': '로그아웃했습니다.',
    'account-switch-complete': '새 Google 계정으로 전환했습니다.',
    'deletion-blocked': '앱 내 자동 삭제는 아직 사용할 수 없습니다. 웹에서 계정 삭제를 요청할 수 있습니다.',
  };
  return copy[kind];
}

function loginFailureCopy(reason: string | undefined): string {
  if (reason === 'ACCOUNT_NOT_INVITED') {
    return '이 Google 계정은 시연에 초대되지 않았습니다. 초대된 다른 계정을 선택해 주세요.';
  }
  if (reason === 'GOOGLE_SIGN_IN_CANCELLED') {
    return 'Google 계정 선택을 취소했습니다. 다른 계정으로 로그인하려면 다시 눌러 주세요.';
  }
  if (reason === 'NETWORK_ERROR') {
    return '로그인 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
  }
  if (reason === 'REQUEST_TIMEOUT') {
    return '로그인 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (reason === 'GOOGLE_SIGN_IN_FAILED') {
    return 'Google 계정 선택을 완료하지 못했습니다. 다시 계정을 선택해 주세요.';
  }
  if (reason === 'LOGIN_RATE_LIMITED') {
    return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  return '로그인을 완료하지 못했습니다. 다시 시도해 주세요.';
}
