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
  // 사장님이 적용한 AI 그림의 상대 경로(`/merchant-art/<sha256>.webp`). 없으면 null이라 앱이 기본 그림을 쓴다.
  artUrl: string | null;
};

export interface MerchantCatalog {
  listPublicMerchants(): Promise<readonly PublicMerchant[]>;
}
