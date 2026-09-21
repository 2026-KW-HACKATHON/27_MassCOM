import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { normalizePublicApiUrl } from '@/config/public-api';

export type AccountDeletionResult = {
  requestId: string;
  status: 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED';
  requestedAt: string;
  completedAt: string | null;
  cancelledMintJobs: number;
  pendingMintJobs: number;
  retainedFinalizedNfts: number;
  replayed: boolean;
};

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  fetchImpl?: typeof fetch;
};

export class AccountDeletionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'AccountDeletionApiError';
  }
}

export class AccountDeletionApiClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.apiUrl = normalizePublicApiUrl(options.apiUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async requestDeletion(): Promise<AccountDeletionResult> {
    const headers = new Headers({
      Accept: 'application/json',
      'content-type': 'application/json',
      ...headersForCredential(this.options.credential),
    });
    if (
      this.options.credential.kind === 'demo'
      && this.options.credential.allowInsecureReauthentication
    ) {
      headers.set('x-demo-reauthenticated', 'true');
    }
    const response = await this.fetchImpl(`${this.apiUrl}/account-deletion-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      throw new AccountDeletionApiError(response.status, code);
    }
    return parseAccountDeletion(payload);
  }
}

function parseAccountDeletion(value: unknown): AccountDeletionResult {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    (value.status !== 'WAITING_FOR_MINT_FINALITY' && value.status !== 'COMPLETED') ||
    typeof value.requestedAt !== 'string' ||
    (value.completedAt !== null && typeof value.completedAt !== 'string') ||
    !isNonNegativeInteger(value.cancelledMintJobs) ||
    !isNonNegativeInteger(value.pendingMintJobs) ||
    !isNonNegativeInteger(value.retainedFinalizedNfts) ||
    typeof value.replayed !== 'boolean' ||
    (value.status === 'COMPLETED' && value.completedAt === null) ||
    (value.status === 'WAITING_FOR_MINT_FINALITY' && value.completedAt !== null)
  ) {
    throw new Error('INVALID_ACCOUNT_DELETION_RESPONSE');
  }
  return {
    requestId: value.requestId,
    status: value.status,
    requestedAt: value.requestedAt,
    completedAt: value.completedAt,
    cancelledMintJobs: value.cancelledMintJobs,
    pendingMintJobs: value.pendingMintJobs,
    retainedFinalizedNfts: value.retainedFinalizedNfts,
    replayed: value.replayed,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
