import type { Pool } from 'pg';

import {
  canManageArt,
  canManageProfile,
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
  staff_can_confirm_visit: boolean;
  staff_can_redeem_coupon: boolean;
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
      `SELECT member.merchant_id, member.role, member.staff_can_confirm_visit, member.staff_can_redeem_coupon
       FROM merchant_members member JOIN merchants merchant ON merchant.id = member.merchant_id
       WHERE member.merchant_id = $1 AND member.account_id = $2 AND member.status = 'ACTIVE'
         AND NOT (merchant.is_demo AND merchant.id LIKE 'showcase-wolgye-%')`,
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
    if (input.permission === 'MANAGE_PROFILE' && !canManageProfile(membership.role, this.staffMayManageArt)) {
      throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    }
    if (membership.role === 'STAFF' && (
      (input.permission === 'CONFIRM_VISIT' && !membership.staff_can_confirm_visit)
      || (input.permission === 'REDEEM_COUPON' && !membership.staff_can_redeem_coupon)
    )) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');

    return {
      merchantId: membership.merchant_id,
      role: membership.role,
      permissions: merchantPermissions,
    };
  }
}
