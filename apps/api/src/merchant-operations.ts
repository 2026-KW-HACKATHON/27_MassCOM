export type MerchantOperationErrorCode =
  | 'MERCHANT_OPERATION_FORBIDDEN' | 'MERCHANT_OPERATION_NOT_FOUND' | 'MERCHANT_OPERATION_INVALID'
  | 'MERCHANT_OPERATION_CONFLICT' | 'MERCHANT_OPERATION_LIMIT' | 'MERCHANT_OPERATION_STAFF_NOT_FOUND';

export class MerchantOperationError extends Error {
  constructor(readonly code: MerchantOperationErrorCode) {
    super(code);
    this.name = 'MerchantOperationError';
  }
}

export type MerchantCampaignOption = {
  id: string; title: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  startsAt: string; endsAt: string; isPublic: boolean;
};

export type MerchantStaffMember = { accountId: string; grantedAt: string;
  confirmVisit: boolean; redeemCoupon: boolean };

export interface MerchantOperations {
  listCampaigns(accountId: string, merchantId: string): Promise<MerchantCampaignOption[]>;
  listStaff(accountId: string, merchantId: string): Promise<MerchantStaffMember[]>;
  approveStaff(input: { accountId: string; merchantId: string; code: string }): Promise<MerchantStaffMember>;
  updateStaffPermissions(input: { accountId: string; merchantId: string; targetAccountId: string;
    confirmVisit: boolean; redeemCoupon: boolean }): Promise<MerchantStaffMember>;
  revokeStaff(input: { accountId: string; merchantId: string; targetAccountId: string }): Promise<void>;
  exportVisits(input: { accountId: string; merchantId: string; fromDate: string; toDate: string }): Promise<{
    filename: string; csv: string; count: number;
  }>;
}
