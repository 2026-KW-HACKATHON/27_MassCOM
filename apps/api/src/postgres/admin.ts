import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

export type AdminMerchant = {
  id: string;
  name: string;
  story: string;
  roadAddress: string;
  minimumSpendWon: number;
  menuItems: { name: string; priceWon: number }[];
  businessHours: string;
  status: 'ACTIVE' | 'PAUSED';
  demo: false;
  version: number;
};

export type MerchantInput = Pick<AdminMerchant, 'name' | 'story' | 'roadAddress' | 'minimumSpendWon'> &
  Partial<Pick<AdminMerchant, 'menuItems' | 'businessHours'>>;

export type AdminOperationsStatus = {
  merchants: {
    id: string; name: string; status: 'ACTIVE' | 'PAUSED';
    claims: { active: number; expired: number; claimed: number };
    visits: number; rewards: number;
    mintJobs: { status: string; count: number }[];
    mintFailures: { code: string; count: number }[];
  }[];
};

type MerchantRow = {
  id: string;
  name: string;
  story: string;
  road_address: string;
  minimum_spend_won: number;
  menu_items: AdminMerchant['menuItems'];
  business_hours: string;
  status: 'ACTIVE' | 'PAUSED';
  is_demo: boolean;
  version: number;
};

export class AdminError extends Error {
  constructor(readonly code: 'ADMIN_FORBIDDEN' | 'ADMIN_IDENTITY_NOT_FOUND' |
    'ADMIN_MERCHANT_NOT_FOUND' | 'ADMIN_VERSION_CONFLICT' | 'ADMIN_PENDING_CLAIMS' | 'ADMIN_INVALID_INPUT') {
    super(code);
    this.name = 'AdminError';
  }
}

const columns = 'id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo, version';

function merchant(row: MerchantRow): AdminMerchant {
  if (row.is_demo) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
  return {
    id: row.id, name: row.name, story: row.story, roadAddress: row.road_address,
    minimumSpendWon: row.minimum_spend_won, menuItems: row.menu_items, businessHours: row.business_hours,
    status: row.status, demo: false, version: row.version,
  };
}

function validate(input: MerchantInput): MerchantInput {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 ||
      typeof input.story !== 'string' || input.story.length > 4000 ||
      typeof input.roadAddress !== 'string' || !input.roadAddress.trim() || input.roadAddress.length > 500 ||
      !Number.isSafeInteger(input.minimumSpendWon) || input.minimumSpendWon < 0 || input.minimumSpendWon > 1_000_000_000 ||
      (input.businessHours !== undefined && (typeof input.businessHours !== 'string' || input.businessHours.length > 1000)) ||
      (input.menuItems !== undefined && (!Array.isArray(input.menuItems) || input.menuItems.length > 30 ||
        input.menuItems.some(item => !item || typeof item.name !== 'string' || !item.name.trim() ||
          item.name.length > 200 || !Number.isSafeInteger(item.priceWon) || item.priceWon < 0 ||
          item.priceWon > 1_000_000_000)))) {
    throw new AdminError('ADMIN_INVALID_INPUT');
  }
  return { name: input.name.trim(), story: input.story.trim(),
    roadAddress: input.roadAddress.trim(), minimumSpendWon: input.minimumSpendWon,
    ...(input.menuItems === undefined ? {} : {
      menuItems: input.menuItems.map(item => ({ name: item.name.trim(), priceWon: item.priceWon })),
    }),
    ...(input.businessHours === undefined ? {} : { businessHours: input.businessHours.trim() }) };
}

export class PostgresAdminService {
  private readonly lifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, hmacSecret: string) {
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async requireAdmin(client: PoolClient, accountId: string): Promise<void> {
    try { await this.lifecycle.assertActive(client, accountId); }
    catch (error) {
      if (error instanceof AccountLifecycleError) throw new AdminError('ADMIN_FORBIDDEN');
      throw error;
    }
    const result = await client.query(
      `SELECT 1 FROM platform_admins AS admin
       JOIN auth_identities AS identity ON identity.account_id = admin.account_id
       WHERE admin.account_id = $1 AND admin.revoked_at IS NULL AND identity.provider = 'google'
       FOR UPDATE OF admin`, [accountId],
    );
    if (result.rowCount !== 1) throw new AdminError('ADMIN_FORBIDDEN');
  }

  async isAdmin(accountId: string): Promise<boolean> {
    try { return await this.transaction(async client => { await this.requireAdmin(client, accountId); return true; }); }
    catch (error) { if (error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN') return false; throw error; }
  }

  async listMerchants(accountId: string): Promise<AdminMerchant[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const result = await client.query<MerchantRow>(
        `SELECT ${columns} FROM merchants WHERE NOT is_demo ORDER BY name, id`,
      );
      return result.rows.map(merchant);
    });
  }

  async operationsStatus(accountId: string): Promise<AdminOperationsStatus> {
    return this.transaction(async client => {
      await client.query("SET LOCAL statement_timeout = '5s'");
      await this.requireAdmin(client, accountId);
      const result = await client.query<{
        id: string; name: string; status: 'ACTIVE' | 'PAUSED';
        active: number; expired: number; claimed: number; visits: number; rewards: number;
        mint_jobs: { status: string; count: number }[];
        mint_failures: { code: string; count: number }[];
      }>(`WITH selected AS MATERIALIZED (
          SELECT id, name, status FROM merchants WHERE NOT is_demo ORDER BY name, id LIMIT 100
        ), claims AS (
          SELECT merchant_id,
            count(*) FILTER (WHERE status = 'ISSUED' AND expires_at > statement_timestamp())::int AS active,
            count(*) FILTER (WHERE status = 'EXPIRED' OR
              (status = 'ISSUED' AND expires_at <= statement_timestamp()))::int AS expired,
            count(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed
          FROM claim_slots WHERE merchant_id IN (SELECT id FROM selected) GROUP BY merchant_id
        ), visits AS (
          SELECT merchant_id, count(*)::int AS count FROM visit_events
          WHERE status = 'VALID' AND merchant_id IN (SELECT id FROM selected) GROUP BY merchant_id
        ), rewards AS (
          SELECT campaign.merchant_id, count(*)::int AS count FROM reward_entitlements AS entitlement
          JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
          WHERE entitlement.status <> 'CANCELED' AND campaign.merchant_id IN (SELECT id FROM selected)
          GROUP BY campaign.merchant_id
        ), mint_base AS MATERIALIZED (
          SELECT campaign.merchant_id, job.status,
            CASE WHEN job.last_error_code IS NULL THEN NULL
              WHEN job.last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$' THEN job.last_error_code
              ELSE 'OTHER' END AS code
          FROM mint_jobs AS job
          JOIN reward_entitlements AS entitlement ON entitlement.id = job.entitlement_id
          JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
          WHERE campaign.merchant_id IN (SELECT id FROM selected)
        ), mint_status_counts AS (
          SELECT merchant_id, status, count(*)::int AS count FROM mint_base GROUP BY merchant_id, status
        ), mint_status AS (
          SELECT merchant_id, jsonb_agg(jsonb_build_object('status', status, 'count', count)
            ORDER BY status) AS items FROM mint_status_counts GROUP BY merchant_id
        ), mint_failure_counts AS (
          SELECT merchant_id, code, count(*)::int AS count FROM mint_base
          WHERE code IS NOT NULL GROUP BY merchant_id, code
        ), mint_failure_ranked AS (
          SELECT merchant_id, code, count,
            row_number() OVER (PARTITION BY merchant_id ORDER BY count DESC, code) AS position
          FROM mint_failure_counts
        ), mint_failures AS (
          SELECT merchant_id, jsonb_agg(jsonb_build_object('code', code, 'count', count)
            ORDER BY count DESC, code) AS items FROM mint_failure_ranked
          WHERE position <= 10 GROUP BY merchant_id
        )
        SELECT selected.id, selected.name, selected.status,
          COALESCE(claims.active, 0) AS active, COALESCE(claims.expired, 0) AS expired,
          COALESCE(claims.claimed, 0) AS claimed, COALESCE(visits.count, 0) AS visits,
          COALESCE(rewards.count, 0) AS rewards,
          COALESCE(mint_status.items, '[]'::jsonb) AS mint_jobs,
          COALESCE(mint_failures.items, '[]'::jsonb) AS mint_failures
        FROM selected LEFT JOIN claims ON claims.merchant_id = selected.id
          LEFT JOIN visits ON visits.merchant_id = selected.id
          LEFT JOIN rewards ON rewards.merchant_id = selected.id
          LEFT JOIN mint_status ON mint_status.merchant_id = selected.id
          LEFT JOIN mint_failures ON mint_failures.merchant_id = selected.id
        ORDER BY selected.name, selected.id`);
      return { merchants: result.rows.map(row => ({
        id: row.id, name: row.name, status: row.status,
        claims: { active: row.active, expired: row.expired, claimed: row.claimed },
        visits: row.visits, rewards: row.rewards,
        mintJobs: row.mint_jobs, mintFailures: row.mint_failures,
      })) };
    });
  }

  async createMerchant(accountId: string, raw: MerchantInput): Promise<AdminMerchant> {
    const input = validate(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const row = (await client.query<MerchantRow>(
        `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAUSED', false) RETURNING ${columns}`,
        [randomUUID(), input.name, input.story, input.roadAddress, input.minimumSpendWon,
          JSON.stringify(input.menuItems ?? []), input.businessHours ?? ''],
      )).rows[0]!;
      const created = merchant(row);
      await this.audit(client, accountId, created.id, 'MERCHANT_CREATED', null, created);
      return created;
    });
  }

  async updateMerchant(accountId: string, id: string, expectedVersion: number, raw: MerchantInput): Promise<AdminMerchant> {
    const input = validate(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const before = await this.lockMerchant(client, id, expectedVersion);
      const row = (await client.query<MerchantRow>(
        `UPDATE merchants SET name = $2, story = $3, road_address = $4,
         minimum_spend_won = $5, menu_items = COALESCE($6::jsonb, menu_items),
         business_hours = COALESCE($7::text, business_hours), version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`,
        [id, input.name, input.story, input.roadAddress, input.minimumSpendWon,
          input.menuItems === undefined ? null : JSON.stringify(input.menuItems), input.businessHours ?? null],
      )).rows[0]!;
      const updated = merchant(row);
      await this.audit(client, accountId, id, 'MERCHANT_UPDATED', before, updated);
      return updated;
    });
  }

  async hideMerchant(accountId: string, id: string, expectedVersion: number): Promise<AdminMerchant> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const before = await this.lockMerchant(client, id, expectedVersion);
      const pending = await client.query(
        `SELECT 1 FROM claim_slots
         WHERE merchant_id = $1 AND status = 'ISSUED' AND expires_at > now()
         LIMIT 1`, [id],
      );
      if (pending.rowCount) throw new AdminError('ADMIN_PENDING_CLAIMS');
      const row = (await client.query<MerchantRow>(
        `UPDATE merchants SET status = 'PAUSED', version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`, [id],
      )).rows[0]!;
      await client.query(
        `UPDATE campaigns SET status = 'PAUSED', is_public = false, updated_at = now()
         WHERE merchant_id = $1 AND status = 'ACTIVE'`, [id],
      );
      const hidden = merchant(row);
      await this.audit(client, accountId, id, 'MERCHANT_HIDDEN', before, hidden);
      return hidden;
    });
  }

  private async lockMerchant(client: PoolClient, id: string, expectedVersion: number): Promise<AdminMerchant> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AdminError('ADMIN_INVALID_INPUT');
    const row = (await client.query<MerchantRow>(
      `SELECT ${columns} FROM merchants WHERE id = $1 AND NOT is_demo FOR UPDATE`, [id],
    )).rows[0];
    if (!row) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
    if (row.version !== expectedVersion) throw new AdminError('ADMIN_VERSION_CONFLICT');
    return merchant(row);
  }

  private async audit(client: PoolClient, actor: string, id: string, action: string,
    before: AdminMerchant | null, after: AdminMerchant): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), actor, id, action, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
  }

  private async auditRole(client: PoolClient, accountId: string, action: 'GRANT' | 'REVOKE'): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_role_audit(id, target_account_id, action)
       VALUES ($1, $2, $3)`, [randomUUID(), accountId, action],
    );
  }

  async grant(subject: string): Promise<void> {
    if (!subject.trim()) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
    await this.transaction(async client => {
      const identity = await client.query<{ account_id: string }>(
        `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`, [subject],
      );
      const accountId = identity.rows[0]?.account_id;
      if (!accountId) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await this.lifecycle.assertActive(client, accountId);
      const current = await client.query(
        `SELECT 1 FROM auth_identities WHERE provider = 'google' AND subject = $1 AND account_id = $2`,
        [subject, accountId],
      );
      if (current.rowCount !== 1) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await client.query(
        `INSERT INTO platform_admins(account_id) VALUES ($1)
         ON CONFLICT (account_id) DO UPDATE SET granted_at = now(), revoked_at = NULL`, [accountId],
      );
      await this.auditRole(client, accountId, 'GRANT');
    });
  }

  async revoke(subject: string): Promise<void> {
    await this.transaction(async client => {
      const identity = await client.query<{ account_id: string }>(
        `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`, [subject],
      );
      const accountId = identity.rows[0]?.account_id;
      if (!accountId) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await this.lifecycle.assertActive(client, accountId);
      const revoked = await client.query(
        `UPDATE platform_admins SET revoked_at = now()
         WHERE account_id = $1 AND revoked_at IS NULL`, [accountId],
      );
      if (revoked.rowCount) await this.auditRole(client, accountId, 'REVOKE');
    });
  }
}
