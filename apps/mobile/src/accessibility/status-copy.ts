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
    'login-failed': '로그인을 완료하지 못했습니다. 다시 시도해 주세요.',
    'claim-preview': `${merchantName}의 ${campaignTitle} 방문 수령 내용을 확인했습니다.`,
    'claim-replayed': `${merchantName}에서 이미 완료된 방문 수령 결과를 복구했습니다.`,
    'collection-binding-outage': '앱 수집품은 표시하지만 외부 지갑 주소 확인 상태는 불러오지 못했습니다.',
    'polling-paused': 'NFT 등록 결과를 확인하지 못해 자동 확인을 멈췄습니다.',
    'polling-recovered': 'NFT 등록 결과를 다시 확인했습니다.',
    'wallet-verified': '외부 지갑 주소 확인을 완료했습니다.',
    'wallet-disconnected': '외부 지갑 연결을 해제했습니다.',
    'logout-complete': '로그아웃했습니다.',
    'account-switch-complete': '새 Google 계정으로 전환했습니다.',
    'deletion-blocked': '운영 계정 삭제는 최근 사용자 확인 수단이 확정되지 않아 아직 요청할 수 없습니다.',
  };
  return copy[kind];
}
