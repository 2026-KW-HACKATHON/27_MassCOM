import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { parseCustomerIdentityToken } from './customer-identity';

export type MerchantContext = {
  merchantId: string;
  role: 'OWNER' | 'STAFF';
  permissions: readonly ('VIEW_MERCHANT' | 'CONFIRM_VISIT')[];
};

export type IssuedClaim = {
  claimSlotId: string;
  token: string;
  tokenVersion: number;
  expiresAt: string;
};

export type CustomerIdentity = { token: string; expiresAt: string };
export type ResolvedCustomerIdentity = { expiresAt: string };
export type IdentityClaim = IssuedClaim | { claimSlotId: string; tokenVersion: number; expiresAt: string; replayed: true };

export type ClaimPreview = {
  claimSlotId: string;
  merchantId: string;
  merchantName: string;
  campaignId: string;
  campaignTitle: string;
  expiresAt: string;
  status: 'AVAILABLE' | 'EXPIRED';
};

export type RedeemedClaim = {
  claimSlotId: string;
  merchantId: string;
  merchantName: string;
  campaignTitle: string;
  status: 'CLAIMED';
  replayed: boolean;
  visit: {
    visitEventId: string;
    campaignId: string;
    businessDate: string;
    verificationLevel: 'MERCHANT_CONFIRMED';
    progressCounted: boolean;
    progressVisitCount: number;
  };
  grantedRewards: readonly {
    entitlementId: string;
    targetVisitCount: 1 | 3 | 5;
    status: 'GRANTED';
    claimExpiresAt: string;
  }[];
};

export type CollectionSnapshot = {
  visits: readonly {
    visitEventId: string;
    merchantId: string;
    merchantName: string;
    campaignId: string;
    campaignTitle: string;
    businessDate: string;
    progressCounted: boolean;
    verificationLevel: 'MERCHANT_CONFIRMED' | 'POS_VERIFIED';
  }[];
  collectibles: readonly {
    entitlementId: string;
    merchantId: string;
    merchantName: string;
    campaignId: string;
    campaignTitle: string;
    targetVisitCount: 1 | 3 | 5;
    displayName: string;
    appCollectibleStatus: 'COLLECTED';
    mintJobId: string | null;
    recipient: string | null;
    nftStatus: 'NOT_REQUESTED' | 'QUEUED' | 'CONFIRMING' | 'FINALIZED' | 'REVIEW_REQUIRED';
    nft: null | {
      chainId: number;
      contractAddress: string;
      tokenId: string;
    };
  }[];
};

export type MintJobResponse = {
  jobId: string;
  status: 'QUEUED' | 'PREPARED' | 'SUBMITTED' | 'CONFIRMING' | 'FINALIZED' | 'RETRYABLE' | 'PAUSED' | 'MANUAL_REVIEW' | 'CANCELLED';
  chainId: number;
  recipient: string;
  nft: null | { contractAddress: string; tokenId: string };
};

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export class CommerceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'CommerceApiError';
  }
}

export function createCommerceApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    const response = await fetcher(`${apiUrl}${path}`, {
      ...init,
      headers,
    });
    const payload = await response.json();
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new CommerceApiError(response.status, code);
    }
    return payload;
  }

  async function post(path: string, body: object): Promise<unknown> {
    return request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  return {
    async createCustomerIdentity(): Promise<CustomerIdentity> {
      return parseCustomerIdentity(await post('/customer/identity-tokens', {}));
    },

    async revokeCustomerIdentity(token: string): Promise<void> {
      const response = await post('/customer/identity-tokens/revoke', { token });
      if (!isRecord(response) || response.status !== 'REVOKED') throw invalidResponse('식별 QR 폐기');
    },

    async resolveCustomerIdentity(merchantId: string, customerIdentityToken: string): Promise<ResolvedCustomerIdentity> {
      const response = await post(`/merchant/merchants/${encodeURIComponent(merchantId)}/customer-identities/resolve`, { customerIdentityToken });
      if (!isRecord(response) || !isDate(response.expiresAt)) throw invalidResponse('고객 식별');
      return { expiresAt: response.expiresAt };
    },

    async issueIdentityClaim(input: { merchantId: string; customerIdentityToken: string }): Promise<IdentityClaim> {
      // The identity token stays stable across a retry. Only its merchant-scoped HMAC is persisted as the reference.
      const response = await post(`/merchant/merchants/${encodeURIComponent(input.merchantId)}/claim-slots`, {
        customerIdentityToken: input.customerIdentityToken,
        merchantReference: input.customerIdentityToken,
        useConfirmed: true,
      });
      if (isRecord(response) && response.replayed === true) {
        if (!isString(response.claimSlotId) || !isPositiveInteger(response.tokenVersion) || !isDate(response.expiresAt) || 'token' in response) {
          throw invalidResponse('기존 수령 코드');
        }
        return { claimSlotId: response.claimSlotId, tokenVersion: response.tokenVersion, expiresAt: response.expiresAt, replayed: true };
      }
      return parseIssuedClaim(response);
    },

    async issueOrReissueIdentityClaim(input: { merchantId: string; customerIdentityToken: string }): Promise<IssuedClaim> {
      const issued = await this.issueIdentityClaim(input);
      return 'replayed' in issued
        ? this.reissueClaim({ merchantId: input.merchantId, claimSlotId: issued.claimSlotId, expectedTokenVersion: issued.tokenVersion })
        : issued;
    },

    async getMerchantContext(merchantId: string): Promise<MerchantContext> {
      return parseMerchantContext(
        await request(`/merchant/merchants/${encodeURIComponent(merchantId)}/context`),
      );
    },

    async issueClaim(input: {
      merchantId: string;
      customerAccountId: string;
      merchantReference: string;
    }): Promise<IssuedClaim> {
      return parseIssuedClaim(
        await post(`/merchant/merchants/${encodeURIComponent(input.merchantId)}/claim-slots`, {
          customerAccountId: input.customerAccountId,
          merchantReference: input.merchantReference,
        }),
      );
    },

    async reissueClaim(input: {
      merchantId: string;
      claimSlotId: string;
      expectedTokenVersion: number;
    }): Promise<IssuedClaim> {
      return parseIssuedClaim(
        await post(
          `/merchant/merchants/${encodeURIComponent(input.merchantId)}/claim-slots/${encodeURIComponent(input.claimSlotId)}/reissue`,
          { expectedTokenVersion: input.expectedTokenVersion },
        ),
      );
    },

    async previewClaim(token: string): Promise<ClaimPreview> {
      return parseClaimPreview(await post('/claim-slots/preview', { token }));
    },

    async redeemClaim(token: string): Promise<RedeemedClaim> {
      return parseRedeemedClaim(await post('/claim-slots/redeem', { token }));
    },

    async getCollection(): Promise<CollectionSnapshot> {
      return parseCollection(await request('/collection'));
    },

    async requestMint(input: {
      entitlementId: string;
      walletBindingId: string;
      bindingVersion: number;
      consentVersion: string;
      idempotencyKey: string;
    }): Promise<MintJobResponse & { replayed: boolean }> {
      return parseMintRequest(
        await request(`/entitlements/${encodeURIComponent(input.entitlementId)}/mint`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
          },
          body: JSON.stringify({
            walletBindingId: input.walletBindingId,
            bindingVersion: input.bindingVersion,
            consentVersion: input.consentVersion,
          }),
        }),
      );
    },

    async getMintJob(jobId: string): Promise<MintJobResponse> {
      return parseMintJob(await request(`/mint-jobs/${encodeURIComponent(jobId)}`));
    },
  };
}

function parseCustomerIdentity(value: unknown): CustomerIdentity {
  if (!isRecord(value) || typeof value.token !== 'string' || !parseCustomerIdentityToken(value.token) || !isDate(value.expiresAt)) {
    throw invalidResponse('식별 QR');
  }
  return { token: value.token, expiresAt: value.expiresAt };
}

function parseMerchantContext(value: unknown): MerchantContext {
  if (
    !isRecord(value) ||
    !isString(value.merchantId) ||
    (value.role !== 'OWNER' && value.role !== 'STAFF') ||
    !Array.isArray(value.permissions) ||
    !value.permissions.every((permission) =>
      permission === 'VIEW_MERCHANT' || permission === 'CONFIRM_VISIT'
    )
  ) {
    throw invalidResponse('점주 권한');
  }
  return {
    merchantId: value.merchantId,
    role: value.role,
    permissions: value.permissions,
  };
}

function parseIssuedClaim(value: unknown): IssuedClaim {
  if (
    !isRecord(value) ||
    !isString(value.claimSlotId) ||
    !isString(value.token) ||
    !isPositiveInteger(value.tokenVersion) ||
    !isDate(value.expiresAt)
  ) {
    throw invalidResponse('수령 코드');
  }
  return {
    claimSlotId: value.claimSlotId,
    token: value.token,
    tokenVersion: value.tokenVersion,
    expiresAt: value.expiresAt,
  };
}

function parseClaimPreview(value: unknown): ClaimPreview {
  if (
    !isRecord(value) ||
    !isString(value.claimSlotId) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.campaignId) ||
    !isString(value.campaignTitle) ||
    !isDate(value.expiresAt) ||
    (value.status !== 'AVAILABLE' && value.status !== 'EXPIRED')
  ) {
    throw invalidResponse('수령 확인');
  }
  return {
    claimSlotId: value.claimSlotId,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    campaignId: value.campaignId,
    campaignTitle: value.campaignTitle,
    expiresAt: value.expiresAt,
    status: value.status,
  };
}

function parseRedeemedClaim(value: unknown): RedeemedClaim {
  if (
    !isRecord(value) ||
    !isString(value.claimSlotId) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.campaignTitle) ||
    value.status !== 'CLAIMED' ||
    typeof value.replayed !== 'boolean' ||
    !isRecord(value.visit) ||
    !isString(value.visit.visitEventId) ||
    !isString(value.visit.campaignId) ||
    !isBusinessDate(value.visit.businessDate) ||
    value.visit.verificationLevel !== 'MERCHANT_CONFIRMED' ||
    typeof value.visit.progressCounted !== 'boolean' ||
    !isNonNegativeInteger(value.visit.progressVisitCount) ||
    !Array.isArray(value.grantedRewards)
  ) {
    throw invalidResponse('방문 수령');
  }
  return {
    claimSlotId: value.claimSlotId,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    campaignTitle: value.campaignTitle,
    status: 'CLAIMED',
    replayed: value.replayed,
    visit: {
      visitEventId: value.visit.visitEventId,
      campaignId: value.visit.campaignId,
      businessDate: value.visit.businessDate,
      verificationLevel: 'MERCHANT_CONFIRMED',
      progressCounted: value.visit.progressCounted,
      progressVisitCount: value.visit.progressVisitCount,
    },
    grantedRewards: value.grantedRewards.map(parseGrantedReward),
  };
}

function parseGrantedReward(value: unknown): RedeemedClaim['grantedRewards'][number] {
  if (
    !isRecord(value) ||
    !isString(value.entitlementId) ||
    !isGoal(value.targetVisitCount) ||
    value.status !== 'GRANTED' ||
    !isDate(value.claimExpiresAt)
  ) {
    throw invalidResponse('방문 보상');
  }
  return {
    entitlementId: value.entitlementId,
    targetVisitCount: value.targetVisitCount,
    status: 'GRANTED',
    claimExpiresAt: value.claimExpiresAt,
  };
}

function parseCollection(value: unknown): CollectionSnapshot {
  if (!isRecord(value) || !Array.isArray(value.visits) || !Array.isArray(value.collectibles)) {
    throw invalidResponse('도감');
  }
  return {
    visits: value.visits.map(parseCollectionVisit),
    collectibles: value.collectibles.map(parseCollectible),
  };
}

function parseCollectionVisit(value: unknown): CollectionSnapshot['visits'][number] {
  if (
    !isRecord(value) ||
    !isString(value.visitEventId) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.campaignId) ||
    !isString(value.campaignTitle) ||
    !isBusinessDate(value.businessDate) ||
    typeof value.progressCounted !== 'boolean' ||
    (value.verificationLevel !== 'MERCHANT_CONFIRMED' && value.verificationLevel !== 'POS_VERIFIED')
  ) {
    throw invalidResponse('도감 방문');
  }
  return {
    visitEventId: value.visitEventId,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    campaignId: value.campaignId,
    campaignTitle: value.campaignTitle,
    businessDate: value.businessDate,
    progressCounted: value.progressCounted,
    verificationLevel: value.verificationLevel,
  };
}

function parseCollectible(value: unknown): CollectionSnapshot['collectibles'][number] {
  if (
    !isRecord(value) ||
    !isString(value.entitlementId) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.campaignId) ||
    !isString(value.campaignTitle) ||
    !isGoal(value.targetVisitCount) ||
    !isString(value.displayName) ||
    value.appCollectibleStatus !== 'COLLECTED' ||
    (value.mintJobId !== null && !isString(value.mintJobId)) ||
    (value.recipient !== null && !isString(value.recipient)) ||
    !isNftStatus(value.nftStatus) ||
    (value.nft !== null && !isNftAsset(value.nft))
  ) {
    throw invalidResponse('도감');
  }
  return {
    entitlementId: value.entitlementId,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    campaignId: value.campaignId,
    campaignTitle: value.campaignTitle,
    targetVisitCount: value.targetVisitCount,
    displayName: value.displayName,
    appCollectibleStatus: 'COLLECTED',
    mintJobId: value.mintJobId,
    recipient: value.recipient,
    nftStatus: value.nftStatus,
    nft: value.nft,
  };
}

function parseMintRequest(value: unknown): MintJobResponse & { replayed: boolean } {
  if (!isRecord(value) || typeof value.replayed !== 'boolean') throw invalidResponse('NFT 접수');
  return { ...parseMintJob(value), replayed: value.replayed };
}

function parseMintJob(value: unknown): MintJobResponse {
  if (
    !isRecord(value) ||
    !isString(value.jobId) ||
    !isMintJobStatus(value.status) ||
    !isPositiveInteger(value.chainId) ||
    !isString(value.recipient) ||
    (value.nft !== null && !isNftAsset(value.nft))
  ) {
    throw invalidResponse('NFT 작업');
  }
  return {
    jobId: value.jobId,
    status: value.status,
    chainId: value.chainId,
    recipient: value.recipient,
    nft: value.nft,
  };
}

function isNftStatus(value: unknown): value is CollectionSnapshot['collectibles'][number]['nftStatus'] {
  return value === 'NOT_REQUESTED' || value === 'QUEUED' || value === 'CONFIRMING' || value === 'FINALIZED' || value === 'REVIEW_REQUIRED';
}

function isMintJobStatus(value: unknown): value is MintJobResponse['status'] {
  return value === 'QUEUED' || value === 'PREPARED' || value === 'SUBMITTED' || value === 'CONFIRMING' || value === 'FINALIZED' || value === 'RETRYABLE' || value === 'PAUSED' || value === 'MANUAL_REVIEW' || value === 'CANCELLED';
}

function isNftAsset(value: unknown): value is { chainId: number; contractAddress: string; tokenId: string } {
  return isRecord(value) && isPositiveInteger(value.chainId) && isString(value.contractAddress) && isString(value.tokenId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDate(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}

function isBusinessDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isGoal(value: unknown): value is 1 | 3 | 5 {
  return value === 1 || value === 3 || value === 5;
}

function invalidResponse(label: string): CommerceApiError {
  return new CommerceApiError(200, 'INVALID_RESPONSE', `${label} 응답 형식이 올바르지 않습니다.`);
}
