import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { normalizePublicApiUrl } from '@/config/public-api';
import { CONSENT_PRIVACY_VERSION, CONSENT_TERMS_VERSION } from './consent-copy';

export type ConsentState = {
  required: boolean;
  termsVersion: string;
  privacyVersion: string;
};

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  fetchImpl?: typeof fetch;
};

export class ConsentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ConsentApiError';
  }
}

/**
 * 동의 여부 조회와 기록(D-059). 서버는 `required`만 알려 주고 쓰기 요청을 막지 않는다. 동의 경로(운영 앱 또는 시연 앱)는 서버가 정하므로
 * 요청 본문에는 화면이 보여 준 두 버전과 세 필수 답만 담는다.
 */
export class ConsentApiClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.apiUrl = normalizePublicApiUrl(options.apiUrl);
    // Called later as this.fetchImpl(...); see auth-api.ts for why this must be bound (web only).
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  async status(): Promise<ConsentState> {
    return parseState(await this.send('GET'));
  }

  /** 세 필수 항목을 모두 눌러야 호출한다. 서버가 같은 버전의 반복 동의를 그대로 받아 주므로 다시 보내도 안전하다. */
  async record(): Promise<ConsentState> {
    return parseState(await this.send('POST', {
      termsVersion: CONSENT_TERMS_VERSION,
      privacyVersion: CONSENT_PRIVACY_VERSION,
      ageConfirmed: true,
      termsAccepted: true,
      privacyAccepted: true,
    }));
  }

  private async send(method: 'GET' | 'POST', body?: object): Promise<unknown> {
    const headers = new Headers({
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headersForCredential(this.options.credential),
    });
    const response = await this.fetchImpl(`${this.apiUrl}/me/consent`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // 프록시 오류 페이지나 빈 본문은 JSON이 아니다. 상태 코드는 그대로 남긴다.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      throw new ConsentApiError(response.status, code);
    }
    if (payload === undefined) throw new Error('INVALID_CONSENT_RESPONSE');
    return payload;
  }
}

function parseState(value: unknown): ConsentState {
  if (
    !isRecord(value) || typeof value.required !== 'boolean' ||
    typeof value.termsVersion !== 'string' || !value.termsVersion.trim() ||
    typeof value.privacyVersion !== 'string' || !value.privacyVersion.trim()
  ) {
    throw new Error('INVALID_CONSENT_RESPONSE');
  }
  return { required: value.required, termsVersion: value.termsVersion, privacyVersion: value.privacyVersion };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
