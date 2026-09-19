export type MintJobStatus =
  | 'QUEUED'
  | 'PREPARED'
  | 'SUBMITTED'
  | 'CONFIRMING'
  | 'FINALIZED'
  | 'RETRYABLE'
  | 'PAUSED'
  | 'MANUAL_REVIEW'
  | 'CANCELLED';

export type MintJobView = {
  jobId: string;
  status: MintJobStatus;
  chainId: number;
  recipient: string;
  walletBindingId: string;
  bindingVersion: number;
  nft: null | {
    contractAddress: string;
    tokenId: string;
  };
};

export type MintRequestResult = Pick<
  MintJobView,
  'jobId' | 'status' | 'chainId' | 'recipient' | 'nft'
> & {
  replayed: boolean;
};

export interface MintRequestService {
  requestMint(input: {
    accountId: string;
    entitlementId: string;
    walletBindingId: string;
    bindingVersion: number;
    consentVersion: string;
    idempotencyKey: string;
  }): Promise<MintRequestResult>;
  getMintJob(input: { accountId: string; jobId: string }): Promise<MintJobView>;
}

export type MintRequestErrorCode =
  | 'ENTITLEMENT_NOT_FOUND'
  | 'ENTITLEMENT_NOT_MINTABLE'
  | 'ENTITLEMENT_EXPIRED'
  | 'WALLET_BINDING_NOT_FOUND'
  | 'WALLET_BINDING_CHANGED'
  | 'CHAIN_MISMATCH'
  | 'CONSENT_REQUIRED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MINT_PENDING'
  | 'CAPACITY_UNAVAILABLE'
  | 'ACCOUNT_DELETED'
  | 'MINT_JOB_NOT_FOUND';

export class MintRequestError extends Error {
  constructor(readonly code: MintRequestErrorCode) {
    super(code);
    this.name = 'MintRequestError';
  }
}
