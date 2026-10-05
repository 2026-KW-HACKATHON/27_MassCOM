export type MerchantProfile = {
  merchantId: string;
  name: string;
  roadAddress: string;
  story: string;
  businessHours: string;
  menuItems: { name: string; priceWon: number }[];
  version: number;
  canEdit: boolean;
  readOnlyReason: 'ROLE' | 'SHARED_DEMO_STORE' | null;
};

export interface MerchantProfileService {
  getProfile(input: { accountId: string; merchantId: string }): Promise<MerchantProfile>;
  updateProfile(input: { accountId: string; merchantId: string; body: unknown }): Promise<MerchantProfile>;
}

export class MerchantProfileError extends Error {
  constructor(readonly code:
    | 'MERCHANT_PROFILE_FORBIDDEN'
    | 'MERCHANT_PROFILE_READ_ONLY'
    | 'MERCHANT_PROFILE_INVALID'
    | 'MERCHANT_PROFILE_VERSION_CONFLICT') {
    super(code);
    this.name = 'MerchantProfileError';
  }
}
