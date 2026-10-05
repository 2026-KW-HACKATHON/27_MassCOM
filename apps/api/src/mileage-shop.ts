import type { MileageGrade } from './mileage-rules.js';

export type MileageShopGradeView = {
  grade: MileageGrade;
  price: number;
  total: number;
  owned: number;
  remaining: number;
  // 그 등급에서 안 가진 것이 남아 있으면 1/remaining, 다 가졌으면(완료) null.
  probabilityPerItem: number | null;
};

export type MileageShopItemView = {
  id: string;
  grade: MileageGrade;
  name: string;
  owned: boolean;
};

export type MileageShopClothingView = {
  id: string;
  name: string;
  owned: boolean;
  equipped: boolean;
};

export type MileageShopSnapshot = {
  mileage: {
    earned: number;
    spent: number;
    balance: number;
    // 시연 서버에서만, 진짜 적립과 따로 balance에 더해진 시연 체험 마일리지(#333). 운영 응답에는 키가 없다.
    showcaseBonus?: number;
    rules: { visit: number; newStore: number; series: number };
  };
  grades: MileageShopGradeView[];
  items: MileageShopItemView[];
  avatar: string | null;
  clothing: {
    items: MileageShopClothingView[];
    equipped: string | null;
    draw: {
      probability: number;
    };
  };
  drawRewards: {
    bonusMileage: {
      min: number;
      max: number;
      probabilityPerAmount: number;
    };
  };
};

export type MileageShopHistoryEntry = {
  id: string;
  amount: number;
  grade: MileageGrade;
  itemId: string;
  itemName: string;
  createdAt: string;
};

export type MileageShopHistory = {
  mileage: { earned: number; spent: number; balance: number; showcaseBonus?: number };
  spends: MileageShopHistoryEntry[];
  nextCursor: string | null;
};

export type MileageRerollResult = {
  item: { id: string; grade: MileageGrade; name: string };
  bonus: { id: string; name: string; slot: 'hat' | 'bag' | 'prop' | 'pose' | 'decor' };
  balance: number;
  replayed: boolean;
  rewards: {
    mileage: {
      amount: number;
      min: number;
      max: number;
      probabilityPerAmount: number;
    };
    clothing: {
      awarded: boolean;
      duplicate: boolean;
      item: { id: string; name: string } | null;
      probability: number;
    };
    sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'];
  };
};

export interface MileageShopService {
  getShop(accountId: string): Promise<MileageShopSnapshot>;
  getHistory(input: { accountId: string; cursor?: string }): Promise<MileageShopHistory>;
  reroll(input: {
    accountId: string;
    grade: MileageGrade;
    requestId: string;
    expectedRemaining: number;
  }): Promise<MileageRerollResult>;
  setAvatar(input: { accountId: string; itemId: string | null }): Promise<{ avatar: string | null }>;
  setClothing(input: { accountId: string; itemId: string | null }): Promise<{ equippedClothing: string | null }>;
}

export type MileageShopErrorCode =
  | 'INVALID_REQUEST'
  | 'SHOP_INSUFFICIENT_MILEAGE'
  | 'SHOP_GRADE_COMPLETE'
  | 'SHOP_STATE_CHANGED'
  | 'SHOP_REQUEST_CONFLICT'
  | 'SHOP_RATE_LIMITED'
  | 'SHOP_ITEM_NOT_OWNED'
  | 'SHOP_CLOTHING_NOT_OWNED'
  | 'ACCOUNT_DELETED';

export class MileageShopError extends Error {
  constructor(
    readonly code: MileageShopErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'MileageShopError';
  }
}
