import { shouldInvalidateSession } from '@/auth/session-invalid';
import type { AccountCredential } from '@/auth/account-credential';
import { ConsentApiError, type ConsentApiClient, type ConsentState } from './consent-api';
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION, type ConsentCheckKey, consentChecks } from './consent-copy';

/** 로그인 직후 동의 화면이 보이는 상태. `accepted`일 때만 메인 탭이 열린다. */
export type ConsentGateState =
  | { kind: 'loading' }
  | { kind: 'required' }
  /** 서버가 이 앱이 보여 주는 문구와 다른 버전을 요구한다: 옛 문구에 동의를 받지 않고 앱 업데이트를 안내한다. */
  | { kind: 'outdated' }
  | { kind: 'accepted' }
  | { kind: 'failed' };

export type ConsentChecks = Record<ConsentCheckKey, boolean>;

export const noChecks: ConsentChecks = { ageConfirmed: false, termsAccepted: false, privacyAccepted: false };

/** 세 필수 항목을 모두 눌러야 "동의하고 시작"이 켜진다. */
export function canSubmitConsent(checks: ConsentChecks): boolean {
  return consentChecks.every(({ key }) => checks[key] === true);
}

export function stateFromServer(state: ConsentState): ConsentGateState {
  if (!state.required) return { kind: 'accepted' };
  return state.termsVersion === CONSENT_TERMS_VERSION && state.privacyVersion === CONSENT_PRIVACY_VERSION
    ? { kind: 'required' }
    : { kind: 'outdated' };
}

export type ConsentClientResult =
  | { kind: 'state'; state: ConsentGateState }
  | { kind: 'sessionInvalid' };

/** 확인하지 못하면(오프라인·서버 오류·옛 서버의 404) 막힌 채로 두지 않고 다시 시도·로그아웃을 보인다. */
export async function loadConsentState(client: Pick<ConsentApiClient, 'status'>, credential: AccountCredential): Promise<ConsentClientResult> {
  try {
    return { kind: 'state', state: stateFromServer(await client.status()) };
  } catch (caught) {
    if (caught instanceof ConsentApiError && shouldInvalidateSession(credential, caught.status, caught.code)) {
      return { kind: 'sessionInvalid' };
    }
    return { kind: 'state', state: { kind: 'failed' } };
  }
}

/** 세 필수 항목이 모두 눌리지 않았으면 서버를 부르지 않는다. 기록하지 못하면(`submitFailed`) 화면은 그대로 두고 다시 누르게 한다. */
export async function submitConsent(
  client: Pick<ConsentApiClient, 'record'>,
  credential: AccountCredential,
  checks: ConsentChecks,
): Promise<ConsentClientResult | { kind: 'submitFailed' }> {
  if (!canSubmitConsent(checks)) return { kind: 'state', state: { kind: 'required' } };
  try {
    const state = await client.record();
    // 기록에 성공했는데 아직 필요하다고 답하면 안전하게 다시 묻는다(버전이 그 사이 바뀐 경우).
    return { kind: 'state', state: stateFromServer(state) };
  } catch (caught) {
    if (caught instanceof ConsentApiError) {
      if (shouldInvalidateSession(credential, caught.status, caught.code)) return { kind: 'sessionInvalid' };
      if (caught.status === 409 && caught.code === 'CONSENT_VERSION_MISMATCH') return { kind: 'state', state: { kind: 'outdated' } };
    }
    return { kind: 'submitFailed' };
  }
}
