/**
 * 이용약관·개인정보 수집·이용 동의(Issue #253, D-059).
 * 버전은 코드 상수다. 약관 또는 처리방침 본문을 실질적으로 바꿀 때 올리면 모든 계정이 다시 동의해야 한다(required=true).
 * 서버는 동의 여부를 알려 주기만 하고 기존 쓰기 요청을 막지 않는다(옛 앱 호환, 단계적 강제).
 */
export const CURRENT_TERMS_VERSION = 'terms-2026-09-30';
export const CURRENT_PRIVACY_VERSION = 'privacy-2026-10-04';

export type ConsentSource = 'WEB' | 'ANDROID' | 'SHOWCASE_APP';

export type ConsentState = {
  required: boolean;
  termsVersion: string;
  privacyVersion: string;
};

export type ConsentRecordInput = {
  accountId: string;
  source: ConsentSource;
  termsVersion: string;
  privacyVersion: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  privacyAccepted: boolean;
};

export type ConsentErrorCode = 'CONSENT_INCOMPLETE' | 'CONSENT_VERSION_MISMATCH' | 'ACCOUNT_DELETED';

export class ConsentError extends Error {
  constructor(readonly code: ConsentErrorCode) {
    super(code);
    this.name = 'ConsentError';
  }
}

export interface ConsentService {
  /** 앱(Bearer) 경로가 기록하는 경로 값. 운영 API는 ANDROID, 시연 서버는 SHOWCASE_APP이다. */
  readonly appSource: 'ANDROID' | 'SHOWCASE_APP';
  status(accountId: string): Promise<ConsentState>;
  record(input: ConsentRecordInput): Promise<ConsentState>;
}

/** 세 필수 값이 모두 true이고 화면이 보여 준 버전이 현재 버전일 때만 통과한다. DB에 닿기 전에 확인한다. */
export function assertConsentComplete(input: Pick<ConsentRecordInput,
  'termsVersion' | 'privacyVersion' | 'ageConfirmed' | 'termsAccepted' | 'privacyAccepted'>): void {
  if (input.ageConfirmed !== true || input.termsAccepted !== true || input.privacyAccepted !== true) {
    throw new ConsentError('CONSENT_INCOMPLETE');
  }
  if (input.termsVersion !== CURRENT_TERMS_VERSION || input.privacyVersion !== CURRENT_PRIVACY_VERSION) {
    throw new ConsentError('CONSENT_VERSION_MISMATCH');
  }
}
