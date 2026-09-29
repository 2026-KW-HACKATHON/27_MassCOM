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
  /** Still requested after the processing deadline. An older server never sends it, so it reads as false. */
  overdue: boolean;
  deletion: {
    status: 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED';
    completedAt: string | null;
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
 * The showcase app's own deletion filing (D-052). The production app has no such route and uses the web page, so
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

  /** Lookup by receipt number alone; the server answers only with state and dates. */
  async status(receipt: string): Promise<DeletionIntakeView> {
    return parseView(await this.send('POST', '/account-deletion-status', { receipt }));
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
    // A proxy error page or an empty body is not JSON. The status still says what happened, so it is not thrown away.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      throw new AccountDeletionIntakeApiError(response.status, code);
    }
    if (payload === undefined) throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
    return payload;
  }
}

/**
 * A failure that carries no answer from the server (offline, timeout, unreadable body, 5xx) does not say whether the
 * server acted, so the screen must ask again instead of assuming either outcome.
 */
export function isAmbiguousIntakeFailure(error: unknown): boolean {
  return !(error instanceof AccountDeletionIntakeApiError) || error.status >= 500;
}

export type IntakeRecheck = { kind: 'found'; view: DeletionIntakeView } | { kind: 'unknown' };

/**
 * Asks the server for the active request after an ambiguous failure. Only a request that is really there is `found`;
 * "none" or a second failure is still `unknown`, because a filing may not be visible yet or the answer may not arrive.
 */
export async function recheckIntake(client: Pick<AccountDeletionIntakeApiClient, 'current'>): Promise<IntakeRecheck> {
  try {
    const view = await client.current();
    return view ? { kind: 'found', view } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
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
    !isNullableString(value.cancelledAt) || !isNullableString(value.processedAt) || !isNullableString(value.rejectReason) ||
    (value.overdue !== undefined && typeof value.overdue !== 'boolean')
  ) {
    throw new Error('INVALID_DELETION_INTAKE_RESPONSE');
  }
  const deletion = value.deletion;
  if (deletion !== null && (!isRecord(deletion) ||
      (deletion.status !== 'WAITING_FOR_MINT_FINALITY' && deletion.status !== 'COMPLETED') ||
      !isNullableString(deletion.completedAt))) {
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
    overdue: value.overdue === true,
    deletion: deletion === null ? null : {
      status: (deletion as Record<string, unknown>).status as 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED',
      completedAt: (deletion as Record<string, unknown>).completedAt as string | null,
    },
  };
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
