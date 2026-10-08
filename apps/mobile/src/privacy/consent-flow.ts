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

export const consentRequiredMessage = '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.';
export const consentRecheckLabel = '동의 확인하기';

export function needsConsentRecheck(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 403
    && 'code' in error && error.code === 'CONSENT_REQUIRED';
}

/**
 * 동의 화면을 보일지(루트 레이아웃의 결정). 실제 로그인한 Bearer 세션이고 API가 설정돼 있고, 이 실행에서 서버가 "이미 동의했다"고 답한 계정이
 * 지금 계정이 아닐 때만 묻는다. 로그아웃하면 묻지 않고(로그인 화면이 먼저), 다른 계정 B로 로그인하면 A의 답을 물려받지 않고 B를 다시 묻는다.
 * 개발용 DEMO 계정은 서버 세션이 없어 처음에는 묻지 않는다. 다만 서버가 동의를 요구해 사용자가 "동의 확인하기"를 눌렀다면
 * (`recheckRequestedAccountId`가 지금 계정) DEMO 계정도 같은 화면으로 동의를 기록한다.
 */
export function shouldAskConsent(input: {
  status: string;
  accountId: string | undefined;
  credential: AccountCredential | undefined;
  apiAvailable: boolean;
  consentedAccountId: string | undefined;
  recheckRequestedAccountId?: string | undefined;
}): boolean {
  if (!input.accountId || !input.apiAvailable || input.consentedAccountId === input.accountId) return false;
  if (input.status === 'signedIn' && input.credential?.kind === 'bearer') return true;
  return input.status === 'demo' && input.credential?.kind === 'demo'
    && input.recheckRequestedAccountId === input.accountId;
}

export const noChecks: ConsentChecks = { ageConfirmed: false, termsAccepted: false, privacyAccepted: false };

/** 세 필수 항목을 모두 눌러야 "동의하고 시작"이 켜진다. */
export function canSubmitConsent(checks: ConsentChecks): boolean {
  return consentChecks.every(({ key }) => checks[key] === true);
}

/** "전체 동의" 상자의 상태: 세 개를 모두 눌렀으면 true, 한두 개만이면 'mixed'(일부), 하나도 없으면 false. */
export function masterConsentState(checks: ConsentChecks): boolean | 'mixed' {
  const count = consentChecks.filter(({ key }) => checks[key] === true).length;
  return count === consentChecks.length ? true : count > 0 ? 'mixed' : false;
}

/** "전체 동의"를 눌렀을 때의 값: 모두 눌려 있으면 모두 해제하고, 없거나 일부만이면 필수 세 개를 모두 켠다. 키는 문구 표(consentChecks)에서 가져온다. */
export function toggleAllConsent(checks: ConsentChecks): ConsentChecks {
  const next = masterConsentState(checks) !== true;
  return Object.fromEntries(consentChecks.map(({ key }) => [key, next])) as ConsentChecks;
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
