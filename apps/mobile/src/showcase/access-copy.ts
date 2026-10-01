import type { ShowcaseAccessRequest } from '@/commerce/commerce-api';

// 점주 체험 권한 요청(#294) 화면 문구·코드 서식. 서버는 코드를 대시 없이 8글자로 돌려준다(access-requests.ts CODE_ALPHABET).
export const ACCESS_CONTACT_ADDRESSES = ['msocs1324@gmail.com', 'priestess4637@gmail.com'] as const;

export function formatAccessCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function accessMailtoUrl(code: string): string {
  const display = formatAccessCode(code);
  const subject = encodeURIComponent(`[MassCOM 시연] 점주 체험 권한 요청 ${display}`);
  const body = encodeURIComponent(`요청 번호: ${display}`);
  return `mailto:${ACCESS_CONTACT_ADDRESSES.join(',')}?subject=${subject}&body=${body}`;
}

export type AccessUiState =
  | { kind: 'none' }
  | { kind: 'pending'; code: string }
  | { kind: 'approved'; code: string }
  | { kind: 'rejected'; code: string };

export function accessUiState(request: ShowcaseAccessRequest | null): AccessUiState {
  if (!request) return { kind: 'none' };
  const code = formatAccessCode(request.code);
  if (request.status === 'PENDING') return { kind: 'pending', code };
  if (request.status === 'APPROVED') return { kind: 'approved', code };
  return { kind: 'rejected', code };
}

export function requestAccessFailureMessage(httpStatus: number | undefined, code: string): string {
  if (httpStatus === 429 || code === 'SHOWCASE_ACCESS_RATE_LIMITED') return '잠시 후 다시 시도해 주세요.';
  if (code === 'SHOWCASE_ACCESS_ALREADY_GRANTED') return '이미 점주 체험 권한이 있어요. 화면을 새로고침해 주세요.';
  if (code === 'ACCOUNT_DELETED') return '계정이 삭제돼 처리할 수 없어요.';
  return '문의를 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}
