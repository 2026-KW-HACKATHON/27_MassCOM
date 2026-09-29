import type { Pool } from 'pg';

import {
  MerchantAccessError,
  merchantPermissions,
  merchantServerPermissions,
  type MerchantAccessControl,
  type MerchantAccessGrant,
  type MerchantPermission,
  type MerchantRole,
} from '../merchant-access.js';

type MerchantMembershipRow = {
  merchant_id: string;
  role: MerchantRole;
};

export class PostgresMerchantAccessControl implements MerchantAccessControl {
  constructor(private readonly pool: Pool) {}

  async requirePermission(input: {
    accountId: string;
    merchantId: string;
    permission: MerchantPermission;
  }): Promise<MerchantAccessGrant> {
    const result = await this.pool.query<MerchantMembershipRow>(
      `SELECT merchant_id, role
       FROM merchant_members
       WHERE merchant_id = $1
         AND account_id = $2
         AND status = 'ACTIVE'`,
      [input.merchantId, input.accountId],
    );
    const membership = result.rows[0];
    const known: readonly MerchantPermission[] = [...merchantPermissions, ...merchantServerPermissions];
    if (!membership || !known.includes(input.permission)) {
      throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    }

    return {
      merchantId: membership.merchant_id,
      role: membership.role,
      permissions: merchantPermissions,
    };
  }
}
