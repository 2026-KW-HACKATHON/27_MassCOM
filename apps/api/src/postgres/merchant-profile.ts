import type { Pool, PoolClient } from 'pg';

import { canManageProfile, MerchantAccessError, type MerchantRole } from '../merchant-access.js';
import { MerchantProfileError, type MerchantProfile, type MerchantProfileService } from '../merchant-profile.js';
import { normalizeMerchantProfileFields } from '../merchant-profile-rules.js';
import type { PostgresAccountLifecycle } from './account-lifecycle.js';

type MerchantRow = {
  id: string;
  name: string;
  road_address: string;
  story: string;
  business_hours: string;
  menu_items: MerchantProfile['menuItems'];
  version: number;
  is_demo: boolean;
};

type MemberRow = { role: MerchantRole };
type TrialRow = { account_id: string; ended_at: Date | null; expires_at: Date };

type ProfileBody = {
  story: string;
  businessHours: string;
  menuItems: MerchantProfile['menuItems'];
  expectedVersion: number;
};

function validateBody(value: unknown): ProfileBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MerchantProfileError('MERCHANT_PROFILE_INVALID');
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== 4 ||
      !['story', 'businessHours', 'menuItems', 'expectedVersion'].every(key => Object.hasOwn(raw, key)) ||
      !Number.isSafeInteger(raw.expectedVersion) || (raw.expectedVersion as number) < 1 ||
      !Array.isArray(raw.menuItems) || raw.menuItems.some(item =>
        !item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).length !== 2 || !Object.hasOwn(item, 'name') || !Object.hasOwn(item, 'priceWon'))) {
    throw new MerchantProfileError('MERCHANT_PROFILE_INVALID');
  }
  const fields = normalizeMerchantProfileFields({
    story: raw.story,
    businessHours: raw.businessHours,
    menuItems: raw.menuItems,
  });
  if (!fields || fields.businessHours === undefined || fields.menuItems === undefined) {
    throw new MerchantProfileError('MERCHANT_PROFILE_INVALID');
  }
  return { story: fields.story, businessHours: fields.businessHours, menuItems: fields.menuItems,
    expectedVersion: raw.expectedVersion as number };
}

export class PostgresMerchantProfileService implements MerchantProfileService {
  private readonly staffMayManageArt: boolean;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;
  private readonly now: () => Date;

  constructor(private readonly pool: Pool, options: {
    staffMayManageArt?: boolean;
    accountLifecycle?: PostgresAccountLifecycle;
    now?: () => Date;
  } = {}) {
    this.staffMayManageArt = options.staffMayManageArt === true;
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
  }

  async getProfile(input: { accountId: string; merchantId: string }): Promise<MerchantProfile> {
    const member = await this.pool.query<MemberRow>(
      `SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
      [input.merchantId, input.accountId],
    );
    if (!member.rows[0]) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    const merchant = await this.pool.query<MerchantRow>(
      `SELECT id, name, road_address, story, business_hours, menu_items, version, is_demo
       FROM merchants WHERE id = $1`, [input.merchantId],
    );
    if (!merchant.rows[0]) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    const trial = await this.trial(this.pool, input.merchantId);
    return this.profile(merchant.rows[0], member.rows[0].role, trial, input.accountId);
  }

  async updateProfile(input: { accountId: string; merchantId: string; body: unknown }): Promise<MerchantProfile> {
    const body = validateBody(input.body);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 계정 삭제·멤버십 회수 경로와 같은 순서로 계정 advisory 잠금 → 가게 행 잠금을 잡는다.
      if (this.accountLifecycle) await this.accountLifecycle.assertActive(client, input.accountId);
      const merchant = await client.query<MerchantRow>(
        `SELECT id, name, road_address, story, business_hours, menu_items, version, is_demo
         FROM merchants WHERE id = $1 FOR UPDATE`, [input.merchantId],
      );
      if (!merchant.rows[0]) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      const member = await client.query<MemberRow>(
        `SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
        [input.merchantId, input.accountId],
      );
      if (!member.rows[0]) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      const trial = await this.trial(client, input.merchantId);
      const profile = this.profile(merchant.rows[0], member.rows[0].role, trial, input.accountId);
      if (profile.readOnlyReason === 'SHARED_DEMO_STORE') {
        throw new MerchantProfileError('MERCHANT_PROFILE_READ_ONLY');
      }
      if (!profile.canEdit) throw new MerchantProfileError('MERCHANT_PROFILE_FORBIDDEN');
      if (profile.version !== body.expectedVersion) {
        throw new MerchantProfileError('MERCHANT_PROFILE_VERSION_CONFLICT');
      }
      const updated = await client.query<MerchantRow>(
        `UPDATE merchants SET story = $2, business_hours = $3, menu_items = $4::jsonb,
           version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING id, name, road_address, story, business_hours, menu_items, version, is_demo`,
        [input.merchantId, body.story, body.businessHours, JSON.stringify(body.menuItems)],
      );
      await client.query('COMMIT');
      return this.profile(updated.rows[0]!, member.rows[0].role, trial, input.accountId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async trial(db: Pick<Pool, 'query'> | PoolClient, merchantId: string): Promise<TrialRow | undefined> {
    const result = await db.query<TrialRow>(
      `SELECT account_id, ended_at, expires_at FROM showcase_guest_trials WHERE merchant_id = $1`,
      [merchantId],
    );
    return result.rows[0];
  }

  private profile(row: MerchantRow, role: MerchantRole, trial: TrialRow | undefined,
    accountId: string): MerchantProfile {
    const personalTrial = trial?.account_id === accountId && trial.ended_at === null &&
      trial.expires_at > this.now();
    const readOnlyReason = row.is_demo && !personalTrial ? 'SHARED_DEMO_STORE'
      : canManageProfile(role, this.staffMayManageArt) ? null : 'ROLE';
    return {
      merchantId: row.id, name: row.name, roadAddress: row.road_address, story: row.story,
      businessHours: row.business_hours, menuItems: row.menu_items, version: row.version,
      canEdit: readOnlyReason === null, readOnlyReason,
    };
  }
}
