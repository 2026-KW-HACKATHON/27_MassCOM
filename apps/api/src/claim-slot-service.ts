export type IssuedClaimSlot = {
  claimSlotId: string;
  token: string;
  tokenVersion: number;
  expiresAt: string;
};

export type ExistingClaimSlot = Omit<IssuedClaimSlot, 'token'> & { replayed: true };

export type RedeemedClaimSlot = {
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
    // 세어지지 않은 이유가 직원 본인 계정 적립일 때만 넣는다(같은 날 두 번째 방문에는 넣지 않는다).
    progressExcludedReason?: 'STAFF_SELF';
  };
  grantedRewards: readonly {
    entitlementId: string;
    targetVisitCount: 1 | 3 | 5;
    status: 'GRANTED';
    claimExpiresAt: string;
  }[];
};

export type ClaimSlotPreview = {
  claimSlotId: string;
  merchantId: string;
  merchantName: string;
  campaignId: string;
  campaignTitle: string;
  expiresAt: string;
  status: 'AVAILABLE' | 'EXPIRED';
};

export interface ClaimSlotService {
  issue(input: {
    merchantId: string;
    customerAccountId: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot>;
  issue(input: {
    merchantId: string;
    customerIdentityToken: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot | ExistingClaimSlot>;
  reissue(input: {
    merchantId: string;
    claimSlotId: string;
    expectedTokenVersion: number;
    requestedByAccountId: string;
  }): Promise<IssuedClaimSlot>;
  preview(input: { accountId: string; token: string }): Promise<ClaimSlotPreview>;
  redeem(input: { accountId: string; token: string }): Promise<RedeemedClaimSlot>;
}

export type ClaimSlotErrorCode =
  | 'CLAIM_SLOT_ALREADY_EXISTS'
  | 'CLAIM_SLOT_NOT_REISSUABLE'
  | 'CLAIM_TOKEN_UNAVAILABLE'
  | 'CLAIM_TOKEN_EXPIRED'
  | 'CLAIM_CAMPAIGN_UNAVAILABLE'
  | 'CLAIM_MERCHANT_INACTIVE'
  | 'CUSTOMER_IDENTITY_UNAVAILABLE'
  | 'CUSTOMER_IDENTITY_EXPIRED'
  | 'ACCOUNT_DELETED';

export class ClaimSlotError extends Error {
  constructor(readonly code: ClaimSlotErrorCode) {
    super(code);
    this.name = 'ClaimSlotError';
  }
}
