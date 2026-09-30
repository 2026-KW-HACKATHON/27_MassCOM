export type CollectionVisit = {
  visitEventId: string;
  merchantId: string;
  merchantName: string;
  campaignId: string;
  campaignTitle: string;
  businessDate: string;
  progressCounted: boolean;
  verificationLevel: 'MERCHANT_CONFIRMED' | 'POS_VERIFIED';
};

export type CollectionCollectible = {
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
};

export type CollectionSnapshot = {
  visits: readonly CollectionVisit[];
  collectibles: readonly CollectionCollectible[];
  // 운영은 발행 서버·메인넷 승인 전까지 권리만 기록하고 발행하지 않는다(#246, D-054). 옛 앱 파서는 이 선택 필드를 무시한다.
  nftMinting?: 'PREPARING';
};

export type NftMintingMode = 'LIVE' | 'PREPARING';

// NFT_MINTING_MODE: 비어 있거나 LIVE면 지금처럼 발행 상태를 그대로 보이고, PREPARING이면 도감에 nftMinting을 더한다.
// 그 밖의 값은 설정 실수이므로 API가 시작하지 않는다.
export function parseNftMintingMode(value: string | undefined): NftMintingMode {
  if (value === undefined || value === '' || value === 'LIVE') return 'LIVE';
  if (value === 'PREPARING') return 'PREPARING';
  throw new Error('NFT_MINTING_MODE must be LIVE or PREPARING');
}

export interface CollectionReader {
  getCollection(accountId: string): Promise<CollectionSnapshot>;
}
