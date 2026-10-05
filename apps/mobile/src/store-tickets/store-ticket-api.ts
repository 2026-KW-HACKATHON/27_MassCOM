import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import type { CollectionSnapshot } from '@/commerce/commerce-api';

export type StoreTicket = CollectionSnapshot['collectibles'][number];
export type OpenedStoreTicket = { opened: true; replayed: boolean };

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export class StoreTicketApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) {
    super(message);
    this.name = 'StoreTicketApiError';
  }
}

export function createStoreTicketApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    const response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    const payload = await response.json();
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new StoreTicketApiError(response.status, code);
    }
    return payload;
  }

  return {
    async listStoreTickets(): Promise<readonly StoreTicket[]> {
      return parseStoreTickets(await request('/me/store-tickets'));
    },

    async openStoreTicket(entitlementId: string): Promise<OpenedStoreTicket> {
      return parseOpenedStoreTicket(
        await request(`/me/store-tickets/${encodeURIComponent(entitlementId)}/open`, { method: 'POST' }),
      );
    },
  };
}

export function parseStoreTickets(value: unknown): readonly StoreTicket[] {
  if (!isRecord(value) || !Array.isArray(value.tickets)) throw invalidResponse('가게권 목록');
  return value.tickets.map(parseStoreTicket);
}

export function parseOpenedStoreTicket(value: unknown): OpenedStoreTicket {
  if (!isRecord(value) || value.opened !== true || typeof value.replayed !== 'boolean') {
    throw invalidResponse('가게권 개봉');
  }
  return { opened: true, replayed: value.replayed };
}

function parseStoreTicket(value: unknown): StoreTicket {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.entitlementId) ||
    !isNonEmptyString(value.merchantId) ||
    !isNonEmptyString(value.merchantName) ||
    !isNonEmptyString(value.campaignId) ||
    !isNonEmptyString(value.campaignTitle) ||
    !isGoal(value.targetVisitCount) ||
    !isNonEmptyString(value.displayName) ||
    !isIsoDate(value.earnedAt) ||
    value.appCollectibleStatus !== 'COLLECTED' ||
    (value.mintJobId !== null && typeof value.mintJobId !== 'string') ||
    (value.recipient !== null && typeof value.recipient !== 'string') ||
    !isNftStatus(value.nftStatus) ||
    (value.nft !== null && !isNftAsset(value.nft))
  ) {
    throw invalidResponse('가게권 목록');
  }
  return {
    entitlementId: value.entitlementId,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    campaignId: value.campaignId,
    campaignTitle: value.campaignTitle,
    targetVisitCount: value.targetVisitCount,
    displayName: value.displayName,
    earnedAt: value.earnedAt,
    appCollectibleStatus: 'COLLECTED',
    mintJobId: value.mintJobId,
    recipient: value.recipient,
    nftStatus: value.nftStatus,
    nft: value.nft,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isGoal(value: unknown): value is 1 | 3 | 5 {
  return value === 1 || value === 3 || value === 5;
}

function isNftStatus(value: unknown): value is StoreTicket['nftStatus'] {
  return value === 'NOT_REQUESTED' || value === 'QUEUED' || value === 'CONFIRMING' || value === 'FINALIZED' || value === 'REVIEW_REQUIRED';
}

function isNftAsset(value: unknown): value is NonNullable<StoreTicket['nft']> {
  return isRecord(value)
    && typeof value.chainId === 'number'
    && Number.isInteger(value.chainId)
    && value.chainId > 0
    && isNonEmptyString(value.contractAddress)
    && isNonEmptyString(value.tokenId);
}

function invalidResponse(label: string): StoreTicketApiError {
  return new StoreTicketApiError(200, 'INVALID_RESPONSE', `${label} 응답 형식이 올바르지 않습니다.`);
}
