import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { artUrlFor } from '../ai-art-rules.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

export class StaffRegistrationError extends Error {
  constructor(readonly code: 'STAFF_FORBIDDEN' | 'STAFF_MERCHANT_NOT_FOUND' |
    'STAFF_CODE_INVALID' | 'STAFF_ALREADY_MEMBER' | 'STAFF_NOT_FOUND') {
    super(code);
    this.name = 'StaffRegistrationError';
  }
}

const codeHash = (code: string) => createHash('sha256').update(code).digest();
const codeTtlMs = 15 * 60 * 1000;

export class PostgresStaffRegistration {
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

  private async active(client: PoolClient, accountId: string): Promise<void> {
    try { await this.lifecycle.assertActive(client, accountId); }
    catch (error) {
      if (error instanceof AccountLifecycleError) throw new StaffRegistrationError('STAFF_FORBIDDEN');
      throw error;
    }
  }

  private async activePair(client: PoolClient, first: string, second: string): Promise<void> {
    try { await this.lifecycle.assertAllActive(client, [first, second]); }
    catch (error) {
      if (error instanceof AccountLifecycleError) throw new StaffRegistrationError('STAFF_FORBIDDEN');
      throw error;
    }
  }

  private async admin(client: PoolClient, accountId: string): Promise<void> {
    await this.active(client, accountId);
    await this.adminRole(client, accountId);
  }

  private async adminRole(client: PoolClient, accountId: string): Promise<void> {
    const result = await client.query(`SELECT 1 FROM platform_admins AS admin
      JOIN auth_identities AS identity ON identity.account_id = admin.account_id
      WHERE admin.account_id = $1 AND admin.revoked_at IS NULL AND identity.provider = 'google'
      FOR UPDATE OF admin`, [accountId]);
    if (result.rowCount !== 1) throw new StaffRegistrationError('STAFF_FORBIDDEN');
  }

  private async merchant(client: PoolClient, merchantId: string, requireActive = true): Promise<void> {
    const result = await client.query(`SELECT 1 FROM merchants
      WHERE id = $1 AND ($2::boolean = false OR status = 'ACTIVE') AND is_demo = false FOR UPDATE`,
    [merchantId, requireActive]);
    if (result.rowCount !== 1) throw new StaffRegistrationError('STAFF_MERCHANT_NOT_FOUND');
  }

  async request(accountId: string, merchantId: string): Promise<{ requestId: string; code: string; expiresAt: string }> {
    return this.transaction(async client => {
      await this.active(client, accountId);
      const identity = await client.query(`SELECT 1 FROM auth_identities
        WHERE account_id = $1 AND provider = 'google'`, [accountId]);
      if (identity.rowCount !== 1) throw new StaffRegistrationError('STAFF_FORBIDDEN');
      await this.merchant(client, merchantId);
      const member = await client.query(`SELECT 1 FROM merchant_members
        WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`, [merchantId, accountId]);
      if (member.rowCount) throw new StaffRegistrationError('STAFF_ALREADY_MEMBER');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + codeTtlMs);
      const code = randomBytes(16).toString('base64url');
      const requestId = randomUUID();
      await client.query(`DELETE FROM staff_registration_requests
        WHERE merchant_id = $1 AND account_id = $2 AND consumed_at IS NULL`, [merchantId, accountId]);
      await client.query(`INSERT INTO staff_registration_requests
        (id, merchant_id, account_id, code_hash, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)`, [requestId, merchantId, accountId, codeHash(code), now, expiresAt]);
      return { requestId, code, expiresAt: expiresAt.toISOString() };
    });
  }

  async approve(adminId: string, merchantId: string, code: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(code)) throw new StaffRegistrationError('STAFF_CODE_INVALID');
    await this.transaction(async client => {
      const candidate = await client.query<{ account_id: string }>(
        `SELECT account_id FROM staff_registration_requests
         WHERE merchant_id = $1 AND code_hash = $2 AND consumed_at IS NULL`,
        [merchantId, codeHash(code)]);
      if (!candidate.rows[0]) {
        await this.admin(client, adminId);
        throw new StaffRegistrationError('STAFF_CODE_INVALID');
      }
      await this.activePair(client, adminId, candidate.rows[0].account_id);
      await this.adminRole(client, adminId);
      // This row lock is shared with claim issuance/reissue, so revocation cannot race a claim.
      await this.merchant(client, merchantId);
      const request = await client.query<{ id: string; account_id: string; expires_at: Date }>(
        `SELECT id, account_id, expires_at FROM staff_registration_requests
         WHERE merchant_id = $1 AND code_hash = $2 AND consumed_at IS NULL
         FOR UPDATE`, [merchantId, codeHash(code)]);
      const row = request.rows[0];
      if (!row) throw new StaffRegistrationError('STAFF_CODE_INVALID');
      if (row.account_id !== candidate.rows[0].account_id) throw new StaffRegistrationError('STAFF_CODE_INVALID');
      const current = await client.query<{ current_time: Date }>('SELECT clock_timestamp() AS current_time');
      if (row.expires_at <= current.rows[0]!.current_time) throw new StaffRegistrationError('STAFF_CODE_INVALID');
      const identity = await client.query(`SELECT 1 FROM auth_identities
        WHERE account_id = $1 AND provider = 'google'`, [row.account_id]);
      if (identity.rowCount !== 1) throw new StaffRegistrationError('STAFF_CODE_INVALID');
      const member = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 FOR UPDATE`,
        [merchantId, row.account_id]);
      if (member.rows[0]?.role === 'OWNER' || member.rows[0]?.status === 'ACTIVE') {
        throw new StaffRegistrationError('STAFF_ALREADY_MEMBER');
      }
      await client.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
        VALUES ($1, $2, 'STAFF', 'ACTIVE')
        ON CONFLICT (merchant_id, account_id) DO UPDATE
        SET status = 'ACTIVE', revoked_at = NULL, updated_at = now()`, [merchantId, row.account_id]);
      await client.query(`UPDATE staff_registration_requests SET consumed_at = now() WHERE id = $1`, [row.id]);
      await client.query(`INSERT INTO staff_registration_audit
        (id, actor_account_id, target_account_id, merchant_id, action, request_id)
        VALUES ($1, $2, $3, $4, 'APPROVED', $5)`,
      [randomUUID(), adminId, row.account_id, merchantId, row.id]);
    });
  }

  async revoke(adminId: string, merchantId: string, accountId: string): Promise<void> {
    await this.transaction(async client => {
      await this.activePair(client, adminId, accountId);
      await this.adminRole(client, adminId);
      await this.merchant(client, merchantId, false);
      const result = await client.query(`UPDATE merchant_members
        SET status = 'REVOKED', revoked_at = now(), updated_at = now()
        WHERE merchant_id = $1 AND account_id = $2 AND role = 'STAFF' AND status = 'ACTIVE'`,
      [merchantId, accountId]);
      if (result.rowCount !== 1) throw new StaffRegistrationError('STAFF_NOT_FOUND');
      await client.query(`INSERT INTO staff_registration_audit
        (id, actor_account_id, target_account_id, merchant_id, action)
        VALUES ($1, $2, $3, $4, 'REVOKED')`, [randomUUID(), adminId, accountId, merchantId]);
    });
  }

  async mine(accountId: string): Promise<{ id: string; name: string; role: 'OWNER' | 'STAFF'; artUrl: string | null }[]> {
    return this.transaction(async client => {
      await this.active(client, accountId);
      const result = await client.query<{ id: string; name: string; role: 'OWNER' | 'STAFF'; art_sha256: string | null }>(
        `SELECT merchant.id, merchant.name, member.role, art.sha256 AS art_sha256
         FROM merchant_members AS member JOIN merchants AS merchant ON merchant.id = member.merchant_id
         LEFT JOIN merchant_art AS art ON art.merchant_id = merchant.id
         WHERE member.account_id = $1 AND member.status = 'ACTIVE' AND merchant.is_demo = false
         ORDER BY merchant.name, merchant.id`, [accountId]);
      return result.rows.map(row => ({ id: row.id, name: row.name, role: row.role,
        artUrl: artUrlFor(row.art_sha256) }));
    });
  }

  async eligible(accountId: string): Promise<{ id: string; name: string }[]> {
    return this.transaction(async client => {
      await this.active(client, accountId);
      const result = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM merchants WHERE status = 'ACTIVE' AND is_demo = false
         ORDER BY name, id`);
      return result.rows;
    });
  }

  async list(adminId: string, merchantId: string): Promise<{ accountId: string; role: 'STAFF'; grantedAt: string }[]> {
    return this.transaction(async client => {
      await this.admin(client, adminId);
      const merchant = await client.query(`SELECT 1 FROM merchants WHERE id = $1 AND is_demo = false`, [merchantId]);
      if (!merchant.rowCount) throw new StaffRegistrationError('STAFF_MERCHANT_NOT_FOUND');
      const result = await client.query<{ account_id: string; granted_at: Date }>(
        `SELECT account_id, granted_at FROM merchant_members
         WHERE merchant_id = $1 AND role = 'STAFF' AND status = 'ACTIVE' ORDER BY granted_at, account_id`, [merchantId]);
      return result.rows.map(row => ({ accountId: row.account_id, role: 'STAFF', grantedAt: row.granted_at.toISOString() }));
    });
  }
}
