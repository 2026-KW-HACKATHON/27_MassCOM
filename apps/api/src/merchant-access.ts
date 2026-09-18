export const merchantPermissions = ['VIEW_MERCHANT', 'CONFIRM_VISIT'] as const;

export type MerchantPermission = (typeof merchantPermissions)[number];
export type MerchantRole = 'OWNER' | 'STAFF';

export type MerchantAccessGrant = {
  merchantId: string;
  role: MerchantRole;
  permissions: readonly MerchantPermission[];
};

export interface MerchantAccessControl {
  requirePermission(input: {
    accountId: string;
    merchantId: string;
    permission: MerchantPermission;
  }): Promise<MerchantAccessGrant>;
}

export class MerchantAccessError extends Error {
  constructor(readonly code: 'MERCHANT_ACCESS_DENIED') {
    super(code);
    this.name = 'MerchantAccessError';
  }
}
