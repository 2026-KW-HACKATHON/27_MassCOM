import type { PendingShowcaseAccessRequest } from '@/commerce/commerce-api';
import { formatAccessCode } from '@/showcase/access-copy';

// 점주 체험 권한 요청 관리자 화면(#294)의 문구·순수 규칙. 화면은 이 값을 그대로 그린다.

const kstOffsetMs = 9 * 60 * 60 * 1000;

/** "12:05" — 한국 시간(KST는 일광절약시간이 없어 고정 +9시간). */
function kstClockLabel(iso: string): string {
  const shifted = new Date(Date.parse(iso) + kstOffsetMs);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(shifted.getUTCHours())}:${two(shifted.getUTCMinutes())}`;
}

export const ADMIN_CONFIRM_TITLE = '권한 요청 수락';
export const ADMIN_CONFIRM_TEXT = '이 계정에 비공개 체험 점주 가게 직원 권한을 줍니다. 수락할까요?';

export function pendingRowText(request: PendingShowcaseAccessRequest): string {
  return `${formatAccessCode(request.code)} · ${kstClockLabel(request.createdAt)}`;
}

export function listPendingFailureMessage(httpStatus: number | undefined, code: string): string {
  if (httpStatus === 403 || code === 'SHOWCASE_APPROVER_REQUIRED') return '이 계정에는 권한 요청을 볼 권한이 없어요.';
  if (code === 'ACCOUNT_DELETED') return '계정이 삭제돼 처리할 수 없어요.';
  return '요청 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

export function decideFailureMessage(httpStatus: number | undefined, code: string): string {
  if (code === 'SHOWCASE_ACCESS_SELF_DECISION') return '본인의 요청은 처리할 수 없어요.';
  if (httpStatus === 403 || code === 'SHOWCASE_APPROVER_REQUIRED') return '이 계정에는 승인 권한이 없어요.';
  if (httpStatus === 404 || code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND') return '이미 처리됐거나 찾을 수 없는 요청이에요. 목록을 새로 불러왔어요.';
  if (code === 'SHOWCASE_ACCESS_ALREADY_DECIDED') return '이미 처리된 요청이에요. 목록을 새로 불러왔어요.';
  if (code === 'ACCOUNT_DELETED') return '계정이 삭제돼 처리할 수 없어요.';
  return '요청을 처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

/** 실패 뒤 목록이 낡았을 수 있어 새로 불러와야 하는 코드. */
export function staleAfterDecideFailure(code: string): boolean {
  return code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND' || code === 'SHOWCASE_ACCESS_ALREADY_DECIDED';
}
