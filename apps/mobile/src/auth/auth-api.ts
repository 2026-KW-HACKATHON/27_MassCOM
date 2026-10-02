import { normalizePublicApiUrl } from '@/config/public-api';

import type { StoredAuthSessionV1 } from './session-store';

type AuthApiClientOptions = {
  apiUrl: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'AuthApiError';
  }
}

export class AuthApiClient {
  readonly #apiUrl: string;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: AuthApiClientOptions) {
    this.#apiUrl = normalizePublicApiUrl(options.apiUrl);
    // Called later as this.#fetcher(...), a method-call that passes this instance as fetch's
    // receiver. A real browser's native fetch brand-checks its receiver and throws "Illegal
    // invocation" unless it is bound back to window first (Node's fetch does not check this,
    // so this was invisible until the web build, Issue #309).
    // Called later as this.#fetcher(...), a method-call that passes this instance as fetch's
    // receiver. A real browser's native fetch brand-checks its receiver and throws "Illegal
    // invocation" unless it is bound back to window first (Node's fetch does not check this,
    // so this was invisible until the web build, Issue #309).
    this.#fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async signIn(idToken: string): Promise<StoredAuthSessionV1> {
    if (!idToken.trim()) throw new AuthApiError(0, 'GOOGLE_ID_TOKEN_REQUIRED');
    const payload = await this.#request('/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!isSession(payload)) throw new AuthApiError(200, 'INVALID_RESPONSE');
    return {
      version: 1,
      sessionToken: payload.sessionToken,
      accountId: payload.accountId,
      expiresAt: payload.expiresAt,
    };
  }

  async startGuestTrial(): Promise<StoredAuthSessionV1> {
    const payload = await this.#request('/auth/guest-trial', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!isSession(payload)) throw new AuthApiError(200, 'INVALID_RESPONSE');
    return {
      version: 1,
      sessionToken: payload.sessionToken,
      accountId: payload.accountId,
      expiresAt: payload.expiresAt,
    };
  }

  async logout(sessionToken: string): Promise<void> {
    const token = sessionToken.trim();
    if (!token) throw new AuthApiError(0, 'SESSION_TOKEN_REQUIRED');
    const payload = await this.#request('/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!isRecord(payload) || payload.status !== 'LOGGED_OUT') {
      throw new AuthApiError(200, 'INVALID_RESPONSE');
    }
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AuthApiError(0, 'REQUEST_TIMEOUT'));
        controller.abort();
      }, this.#timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        let response: Response;
        try {
          response = await this.#fetcher(`${this.#apiUrl}${path}`, {
            ...init,
            signal: controller.signal,
          });
        } catch {
          throw new AuthApiError(0, 'NETWORK_ERROR');
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new AuthApiError(response.status, 'INVALID_RESPONSE');
        }
        if (!response.ok) {
          const code = isRecord(payload) && typeof payload.code === 'string'
            ? payload.code
            : `HTTP_${response.status}`;
          throw new AuthApiError(response.status, code);
        }
        return payload;
      })()]);
    } finally {
      clearTimeout(timer!);
    }
  }
}

function isSession(value: unknown): value is Omit<StoredAuthSessionV1, 'version'> {
  return isRecord(value)
    && isString(value.sessionToken)
    && isString(value.accountId)
    && isString(value.expiresAt)
    && Number.isFinite(Date.parse(value.expiresAt));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
