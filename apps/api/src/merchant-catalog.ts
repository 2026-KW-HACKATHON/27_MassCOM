export type PublicRewardGoal = {
  targetVisitCount: 1 | 3 | 5;
  displayName: string;
};

export type PublicCampaign = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  enrollmentStatus: 'OPEN' | 'FULL';
  rewardGoals: readonly PublicRewardGoal[];
};

export type PublicMerchant = {
  id: string;
  name: string;
  story: string;
  roadAddress: string;
  minimumSpendWon: number;
  menuItems: readonly { name: string; priceWon: number }[];
  businessHours: string;
  campaign: PublicCampaign;
  demo: boolean;
};

export interface MerchantCatalog {
  listPublicMerchants(): Promise<readonly PublicMerchant[]>;
}
