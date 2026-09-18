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
  verifiedAt: string;
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

  async #post<T>(path: string, body: object): Promise<T> {
    const response = await this.#fetcher(`${this.#apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-account-id': this.#accountId,
      },
      body: JSON.stringify(body),
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
