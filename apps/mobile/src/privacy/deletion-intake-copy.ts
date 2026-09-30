import type { AccountCredential } from '@/auth/account-credential';

import {
  AccountDeletionIntakeApiError,
  type DeletionIntakeView,
  type IntakeRecheck,
} from './account-deletion-intake-api';

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

/** Shown when a request is still waiting after its 7 day deadline; the app does not promise a new date. */
export const overdueMessage = '처리 기한이 지났어요. 문의해 주세요.';

export type IntakeDescription = { title: string; lines: string[]; canCancel: boolean };

export function describeDeletionIntake(view: DeletionIntakeView, now: Date): IntakeDescription {
  if (view.status === 'CANCELLED') {
    return { title: '삭제 요청을 취소했어요', lines: ['계정은 그대로 남아 있습니다.'], canCancel: false };
  }
  if (view.status === 'REJECTED') {
    return {
      title: '삭제 요청이 처리되지 않았어요',
      lines: [`사유: ${view.rejectReason ?? '-'}`, '계정은 삭제되지 않았고 다시 요청할 수 있습니다.'],
      canCancel: false,
    };
  }
  if (view.status === 'PROCESSED') {
    const done = view.deletion?.status === 'COMPLETED';
    return {
      title: done ? '삭제 처리가 끝났어요' : '삭제 처리 중이에요',
      lines: done ? [] : ['제출된 거래의 결과를 확인하기 전에는 완료라고 표시하지 않습니다.'],
      canCancel: false,
    };
  }
  const canCancel = now.getTime() <= Date.parse(view.cancelUntil);
  return {
    title: '삭제 요청이 접수됐어요',
    lines: [
      `접수 ${formatKstMinute(view.requestedAt)}`,
      canCancel
        ? `${formatKstMinute(view.cancelUntil)}까지 취소할 수 있습니다.`
        : '취소 기간이 지났습니다. 운영자가 확인해 처리합니다.',
      `처리 기한 ${formatKstMinute(view.dueAt)}`,
      ...(view.overdue ? [overdueMessage] : []),
    ],
    canCancel,
  };
}

/** The receipt lookup never says more than the server did; each failure is worded for what the person can do next. */
export function lookupFailureMessage(error: unknown): string {
  if (error instanceof AccountDeletionIntakeApiError) {
    if (error.status === 404) return '접수번호를 확인할 수 없습니다. 입력을 다시 확인해 주세요.';
    if (error.status === 429) return '조회가 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.';
  }
  return '지금은 상태를 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.';
}

export const intakeUnknownMessage = '접수 여부를 확인하지 못했어요. 다시 확인해 주세요.';

export type AmbiguousIntakeAction = 'file' | 'reissue' | 'cancel';

export type AmbiguousFailureOutcome = {
  /** 서버에 실제로 있는 요청. 확인하지 못했으면 undefined(모름)로 두어 다시 확인하게 한다. */
  intake: DeletionIntakeView | undefined;
  intakeUnknown: boolean;
  message?: string;
  error?: string;
  /** 다시 받기가 응답 없이 실패하면 서버가 번호를 이미 바꿨을 수 있어, 화면의 이전 접수번호를 지운다. */
  clearReceipt: boolean;
};

/** 응답 없는 실패 뒤 서버에 다시 물은 결과로 화면이 무엇을 보여 줄지 정한다. */
export function ambiguousFailureOutcome(
  action: AmbiguousIntakeAction,
  rechecked: IntakeRecheck,
): AmbiguousFailureOutcome {
  const clearReceipt = action === 'reissue';
  if (rechecked.kind !== 'found') return { intake: undefined, intakeUnknown: true, clearReceipt };
  const found = { intake: rechecked.view, intakeUnknown: false, clearReceipt };
  if (action === 'cancel') {
    return { ...found, error: '취소되었는지 확인하지 못했어요. 삭제 요청은 아직 접수된 상태입니다.' };
  }
  return {
    ...found,
    message: action === 'file'
      ? '삭제 요청이 접수된 것을 확인했어요. 접수번호를 이 화면에서 받지 못했다면 접수번호 다시 받기로 받아 주세요.'
      : '접수번호가 새로 발급됐을 수 있어 이전 번호는 지웠어요. 새 번호가 필요하면 접수번호 다시 받기로 받아 주세요.',
  };
}
