import { statusAnnouncement } from '@/accessibility/status-copy';

export const guestTrialStartLabel = '로그인 없이 바로 체험';
export const guestTrialRestartLabel = '체험 처음부터 다시';
export const guestTrialDescription = '24시간 동안 쓰는 임시 체험 계정이에요. 체험 가게의 사장님 화면도 열 수 있어요. 로그아웃하거나 시간이 지나면 기록은 이어지지 않아요.';
export const guestTrialRestartConfirmation = '현재 체험 기록은 이어지지 않아요. 새 체험 계정으로 처음부터 시작할까요?';

export function guestTrialFailureMessage(reason: string | undefined, platform: 'native' | 'web'): string {
  if (reason === 'SECURE_STORAGE_UNAVAILABLE') {
    return platform === 'web'
      ? '이 브라우저에 체험 기록을 저장할 수 없어 복원하지 않았습니다.'
      : '기기 보안 저장소를 사용할 수 없어 로그인 정보를 복원하지 않았습니다.';
  }
  if (reason === 'WEB_SHOWCASE_ONLY' || reason === 'CONFIGURATION_REQUIRED') {
    return '웹 체험판은 시연 전용이에요.';
  }
  return statusAnnouncement('login-failed', reason ? { reason } : {});
}

export function guestTrialAccountLabel(expiresAt?: string, now = Date.now()): string {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(expiry)) return '임시 체험 계정';
  return `임시 체험 계정 · ${Math.max(0, Math.ceil((expiry - now) / 3_600_000))}시간 남음`;
}
