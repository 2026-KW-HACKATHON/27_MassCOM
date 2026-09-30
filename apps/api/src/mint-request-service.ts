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
  | 'MINT_JOB_NOT_FOUND'
  // 운영이 발행 준비 중(NFT_MINTING_MODE=PREPARING, D-054)이라 새 발행 요청을 받지 않는다.
  | 'NFT_MINTING_PREPARING';

export class MintRequestError extends Error {
  constructor(readonly code: MintRequestErrorCode) {
    super(code);
    this.name = 'MintRequestError';
  }
}

// 발행 서버·메인넷 승인 전(PREPARING)에는 새 발행 요청을 409 NFT_MINTING_PREPARING으로 거절하고 작업 조회만 그대로 둔다.
// 운영 DB에는 NFT 시리즈가 없어 지금도 작업이 생기지 않지만, 시리즈가 먼저 들어가도 발행이 시작되지 않게 하는 이중 방어다.
export function refuseMintRequestsWhilePreparing(service: MintRequestService): MintRequestService {
  return {
    requestMint: async () => { throw new MintRequestError('NFT_MINTING_PREPARING'); },
    getMintJob: (input) => service.getMintJob(input),
  };
}
