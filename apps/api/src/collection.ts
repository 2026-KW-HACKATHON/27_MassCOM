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
};

export interface CollectionReader {
  getCollection(accountId: string): Promise<CollectionSnapshot>;
}
