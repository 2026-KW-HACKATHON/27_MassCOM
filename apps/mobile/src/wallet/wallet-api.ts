export type WalletChallengeResponse = {
  challengeId: string;
  address: string;
  chainId: 84532;
  message: string;
  expiresAt: string;
};

export type WalletVerificationResponse = {
  verifiedAddress: string;
  walletLinkVersion: string;
  walletBindingId: string;
  bindingVersion: number;
  verifiedAt: string;
};

export type ActiveWalletBindingResponse = {
  binding: null | {
    bindingId: string;
    bindingVersion: number;
    address: string;
    chainId: 84532;
    verifiedAt: string;
  };
};

type VerifyChallengeInput = {
  challengeId: string;
  message: string;
  signature: string;
  currentAddress: string;
};

type WalletApiClientOptions = {
  apiUrl: string;
  accountId: string;
  fetcher?: typeof fetch;
};

export class WalletApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'WalletApiError';
  }
}

export class WalletApiClient {
  readonly #apiUrl: string;
  readonly #accountId: string;
  readonly #fetcher: typeof fetch;

  constructor(options: WalletApiClientOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/$/, '');
    this.#accountId = options.accountId;
    this.#fetcher = options.fetcher ?? fetch;
  }

  createChallenge(address: string): Promise<WalletChallengeResponse> {
    return this.#post('/wallet/challenges', { address, chainId: 84532 });
  }

  verifyChallenge(input: VerifyChallengeInput): Promise<WalletVerificationResponse> {
    return this.#post('/wallet/verify', input);
  }

  getActiveBinding(): Promise<ActiveWalletBindingResponse> {
    return this.#request('/wallets/active-binding');
  }

  disconnectBinding(bindingId: string, bindingVersion: number): Promise<{ status: 'DISCONNECTED' }> {
    return this.#request(`/wallets/${encodeURIComponent(bindingId)}/binding`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bindingVersion }),
    });
  }

  async #post<T>(path: string, body: object): Promise<T> {
    return this.#request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async #request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#fetcher(`${this.#apiUrl}${path}`, {
      ...init,
      headers: {
        'x-account-id': this.#accountId,
        ...init?.headers,
      },
    });

    const payload = (await response.json()) as T | { code?: string };
    if (!response.ok) {
      const code = 'code' in (payload as object) && typeof (payload as { code?: unknown }).code === 'string'
        ? (payload as { code: string }).code
        : `HTTP_${response.status}`;
      throw new WalletApiError(response.status, code);
    }
    return payload as T;
  }
}
