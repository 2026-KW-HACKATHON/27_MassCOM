export type IssuedClaimSlot = {
  claimSlotId: string;
  token: string;
  tokenVersion: number;
  expiresAt: string;
};

export type RedeemedClaimSlot = {
  claimSlotId: string;
  merchantId: string;
  status: 'CLAIMED';
};

export type ClaimSlotPreview = {
  claimSlotId: string;
  merchantId: string;
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
  | 'CLAIM_TOKEN_EXPIRED';

export class ClaimSlotError extends Error {
  constructor(readonly code: ClaimSlotErrorCode) {
    super(code);
    this.name = 'ClaimSlotError';
  }
}
