import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { normalizePublicApiUrl } from '@/config/public-api';

export type DeletionIntakeStatus = 'REQUESTED' | 'CANCELLED' | 'PROCESSED' | 'REJECTED';

/** What filing returns. `receipt` is present only when a new one was issued; the server keeps just its hash. */
export type DeletionIntakeReceipt = {
  receipt?: string;
  receiptIssued: boolean;
  status: 'REQUESTED';
  requestedAt: string;
  cancelUntil: string;
  dueAt: string;
};

export type DeletionIntakeView = {
  status: DeletionIntakeStatus;
  requestedAt: string;
  cancelUntil: string;
  dueAt: string;
  cancelledAt: string | null;
  processedAt: string | null;
  rejectReason: string | null;
  deletion: {
    status: 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED';
    completedAt: string | null;
    pendingMintJobs: number;
    retainedFinalizedNfts: number;
  } | null;
};

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  fetchImpl?: typeof fetch;
};

export class AccountDeletionIntakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'AccountDeletionIntakeApiError';
  }
}

/**
 * The showcase app's own deletion filing (D-051). The production app has no such route and uses the web page, so
 * this client is only constructed for the showcase package. Nothing here deletes an account.
 */
export class AccountDeletionIntakeApiClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: Options) {
    this.apiUrl = normalizePublicApiUrl(options.apiUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async request(input: { reissue?: boolean } = {}): Promise<DeletionIntakeReceipt> {
    const payload = await this.send('POST', '/account-deletion-intake', input.reissue ? { reissue: true } : {});
    return parseReceipt(payload);
  }

  async current(): Promise<DeletionIntakeView | undefined> {
    const payload = await this.send('GET', '/account-deletion-intake');
    if (!isRecord(payload) || !('request' in payload)) throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
    return payload.request === null ? undefined : parseView(payload.request);
  }

  async cancel(): Promise<void> {
    const payload = await this.send('POST', '/account-deletion-intake/cancel', {});
    if (!isRecord(payload) || payload.status !== 'CANCELLED') throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
  }

  private async send(method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> {
    const headers = new Headers({
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headersForCredential(this.options.credential),
    });
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      throw new AccountDeletionIntakeApiError(response.status, code);
    }
    return payload;
  }
}

const statuses: readonly string[] = ['REQUESTED', 'CANCELLED', 'PROCESSED', 'REJECTED'];

function parseReceipt(value: unknown): DeletionIntakeReceipt {
  if (
    !isRecord(value) || value.status !== 'REQUESTED' || typeof value.receiptIssued !== 'boolean' ||
    typeof value.requestedAt !== 'string' || typeof value.cancelUntil !== 'string' || typeof value.dueAt !== 'string' ||
    (value.receipt !== undefined && typeof value.receipt !== 'string') ||
    (value.receiptIssued && (typeof value.receipt !== 'string' || !value.receipt.trim())) ||
    (!value.receiptIssued && value.receipt !== undefined)
  ) {
    throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
  }
  return {
    ...(typeof value.receipt === 'string' ? { receipt: value.receipt } : {}),
    receiptIssued: value.receiptIssued,
    status: 'REQUESTED',
    requestedAt: value.requestedAt,
    cancelUntil: value.cancelUntil,
    dueAt: value.dueAt,
  };
}

function parseView(value: unknown): DeletionIntakeView {
  if (
    !isRecord(value) || typeof value.status !== 'string' || !statuses.includes(value.status) ||
    typeof value.requestedAt !== 'string' || typeof value.cancelUntil !== 'string' || typeof value.dueAt !== 'string' ||
    !isNullableString(value.cancelledAt) || !isNullableString(value.processedAt) || !isNullableString(value.rejectReason)
  ) {
    throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
  }
  const deletion = value.deletion;
  if (deletion !== null && (!isRecord(deletion) ||
      (deletion.status !== 'WAITING_FOR_MINT_FINALITY' && deletion.status !== 'COMPLETED') ||
      !isNullableString(deletion.completedAt) || !isCount(deletion.pendingMintJobs) || !isCount(deletion.retainedFinalizedNfts))) {
    throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
  }
  return {
    status: value.status as DeletionIntakeStatus,
    requestedAt: value.requestedAt,
    cancelUntil: value.cancelUntil,
    dueAt: value.dueAt,
    cancelledAt: value.cancelledAt as string | null,
    processedAt: value.processedAt as string | null,
    rejectReason: value.rejectReason as string | null,
    deletion: deletion === null ? null : {
      status: (deletion as Record<string, unknown>).status as 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED',
      completedAt: (deletion as Record<string, unknown>).completedAt as string | null,
      pendingMintJobs: (deletion as Record<string, unknown>).pendingMintJobs as number,
      retainedFinalizedNfts: (deletion as Record<string, unknown>).retainedFinalizedNfts as number,
    },
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
