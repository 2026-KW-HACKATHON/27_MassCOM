import type { AccountCredential } from '@/auth/account-credential';

import type { DeletionIntakeView } from './account-deletion-intake-api';

const showcasePackage = 'kr.masscom.wolgye.demo';

/** Only the showcase app files a deletion from inside the app (D-052); the production app opens the web page. */
export function canRequestShowcaseDeletion(
  packageId: string | null | undefined,
  credential: AccountCredential,
): boolean {
  return packageId === showcasePackage && credential.kind === 'bearer';
}

/** UTC ISO from the server, shown as Korea Standard Time to the minute. */
export function formatKstMinute(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '-';
  return `${new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')} KST`;
}

export type IntakeDescription = { title: string; lines: string[]; canCancel: boolean };

export function describeDeletionIntake(view: DeletionIntakeView, now: Date): IntakeDescription {
  if (view.status === 'CANCELLED') {
    return { title: '탈퇴 요청을 취소했어요', lines: ['계정은 그대로 남아 있습니다.'], canCancel: false };
  }
  if (view.status === 'REJECTED') {
    return {
      title: '탈퇴 요청이 처리되지 않았어요',
      lines: [`사유: ${view.rejectReason ?? '-'}`, '계정은 삭제되지 않았고 다시 요청할 수 있습니다.'],
      canCancel: false,
    };
  }
  if (view.status === 'PROCESSED') {
    const done = view.deletion?.status === 'COMPLETED';
    return {
      title: done ? '탈퇴 처리가 끝났어요' : '탈퇴 처리 중이에요',
      lines: done ? [] : ['제출된 거래의 결과를 확인하기 전에는 완료라고 표시하지 않습니다.'],
      canCancel: false,
    };
  }
  const canCancel = now.getTime() <= Date.parse(view.cancelUntil);
  return {
    title: '탈퇴 요청이 접수됐어요',
    lines: [
      `접수 ${formatKstMinute(view.requestedAt)}`,
      canCancel
        ? `${formatKstMinute(view.cancelUntil)}까지 취소할 수 있습니다.`
        : '취소 기간이 지났습니다. 운영자가 확인해 처리합니다.',
      `처리 기한 ${formatKstMinute(view.dueAt)}`,
    ],
    canCancel,
  };
}
