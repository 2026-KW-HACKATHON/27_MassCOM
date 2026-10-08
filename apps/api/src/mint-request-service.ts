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
  // 옛 판(예: nft-mint-v1)의 동의로 온 요청. 앱을 업데이트해야 새 동의 문구를 볼 수 있다(Issue #254).
  | 'CONSENT_VERSION_OUTDATED'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MINT_PENDING'
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

// 발행 동의 판(Issue #254, D-060). 판은 nft-mint-v<N>이고 v2부터 가게 정보·방문 단계의 영구 공개와 발행 시각 기록을 알린다.
const consentVersionPattern = /^nft-mint-v([1-9][0-9]{0,3})$/;
export const minimumMintConsentVersion = 2;

// API 시작 때 받는 판. 비어 있으면 v2, 형식이 틀리거나 v2보다 낮으면 시작하지 않는다.
export function mintConsentVersionFromEnv(raw: string | undefined): string {
  const value = raw?.trim() || 'nft-mint-v2';
  const match = consentVersionPattern.exec(value);
  if (!match || Number(match[1]) < minimumMintConsentVersion) {
    throw new Error('NFT_MINT_CONSENT_VERSION must be nft-mint-v2 or later');
  }
  return value;
}

// 요청의 판을 확인한다. 같으면 통과, 더 낮은 판이면 옛 앱(CONSENT_VERSION_OUTDATED), 없거나 모르는 값이면 CONSENT_REQUIRED.
export function consentVersionRefusal(
  submitted: unknown, supported: string,
): 'CONSENT_REQUIRED' | 'CONSENT_VERSION_OUTDATED' | undefined {
  if (submitted === supported) return undefined;
  const submittedMatch = typeof submitted === 'string' ? consentVersionPattern.exec(submitted) : null;
  const supportedMatch = consentVersionPattern.exec(supported);
  if (submittedMatch && supportedMatch && Number(submittedMatch[1]) < Number(supportedMatch[1])) {
    return 'CONSENT_VERSION_OUTDATED';
  }
  return 'CONSENT_REQUIRED';
}
