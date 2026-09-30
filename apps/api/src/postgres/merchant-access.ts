import type { Pool } from 'pg';

import {
  canManageArt,
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

export type PostgresMerchantAccessOptions = {
  // false(기본)면 MANAGE_ART는 활성 OWNER만, true면 활성 OWNER·STAFF(D-048). 다른 권한에는 영향이 없다.
  staffMayManageArt?: boolean;
};

export class PostgresMerchantAccessControl implements MerchantAccessControl {
  private readonly staffMayManageArt: boolean;

  constructor(private readonly pool: Pool, options: PostgresMerchantAccessOptions = {}) {
    this.staffMayManageArt = options.staffMayManageArt === true;
  }

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
    // AI 가게 그림은 비용이 나가는 기능이다: 기본은 OWNER만이고 STAFF는 설정으로 켠 환경(시연)에서만 허용한다.
    if (input.permission === 'MANAGE_ART' && !canManageArt(membership.role, this.staffMayManageArt)) {
      throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    }

    return {
      merchantId: membership.merchant_id,
      role: membership.role,
      permissions: merchantPermissions,
    };
  }
}
