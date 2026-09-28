import { createHash, randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { CustomerIdentityError, type CustomerIdentityService } from '../customer-identity.js';
import { MerchantAccessError } from '../merchant-access.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

export const hashCustomerIdentityToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

export const isCustomerIdentityToken = (token: string): boolean =>
  /^masscom-customer:v1:[A-Za-z0-9_-]{43}$/.test(token);

export class PostgresCustomerIdentityService implements CustomerIdentityService {
  private readonly now: () => Date;
  private readonly nextToken: () => string;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, options: {
    now?: () => Date;
    nextToken?: () => string;
    accountLifecycle: PostgresAccountLifecycle;
  }) {
    this.now = options.now ?? (() => new Date());
    this.nextToken = options.nextToken ?? (() => `masscom-customer:v1:${randomBytes(32).toString('base64url')}`);
    this.accountLifecycle = options.accountLifecycle;
  }

  async create(accountId: string) {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 120_000);
    const token = this.nextToken();
    if (!isCustomerIdentityToken(token)) throw new Error('customer identity token generator returned an invalid token');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, accountId);
      await client.query(
        `UPDATE customer_identity_tokens SET revoked_at = $2
         WHERE customer_account_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [accountId, createdAt],
      );
      await client.query(
        `INSERT INTO customer_identity_tokens (token_hash, customer_account_id, expires_at, created_at)
         VALUES ($1, $2, $3, $4)`,
        [hashCustomerIdentityToken(token), accountId, expiresAt, createdAt],
      );
      await client.query('COMMIT');
      return { token, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new CustomerIdentityError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(input: { token: string; merchantId: string; staffAccountId: string }) {
    if (!isCustomerIdentityToken(input.token)) throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const membership = await client.query(
        `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
        [input.merchantId, input.staffAccountId],
      );
      if (!membership.rowCount) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      const tokenHash = hashCustomerIdentityToken(input.token);
      const found = await client.query<{ customer_account_id: string; expires_at: Date; revoked_at: Date | null; consumed_at: Date | null; bound_merchant_id: string | null; bound_staff_account_id: string | null }>(
        `SELECT customer_account_id, expires_at, revoked_at, consumed_at, bound_merchant_id, bound_staff_account_id
         FROM customer_identity_tokens WHERE token_hash = $1`,
        [tokenHash],
      );
      const row = found.rows[0];
      if (!row || row.revoked_at || row.consumed_at ||
          (row.bound_merchant_id && (row.bound_merchant_id !== input.merchantId || row.bound_staff_account_id !== input.staffAccountId))) {
        throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
      }
      if (row.expires_at.getTime() <= this.now().getTime()) throw new CustomerIdentityError('CUSTOMER_IDENTITY_EXPIRED');
      await this.accountLifecycle.assertAllActive(client, [input.staffAccountId, row.customer_account_id]);
      const bound = await client.query(
        `UPDATE customer_identity_tokens SET bound_merchant_id = $2, bound_staff_account_id = $3
         WHERE token_hash = $1 AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > $4
           AND (bound_merchant_id IS NULL OR (bound_merchant_id = $2 AND bound_staff_account_id = $3))
           AND EXISTS (SELECT 1 FROM merchant_members WHERE merchant_id = $2 AND account_id = $3 AND status = 'ACTIVE')`,
        [tokenHash, input.merchantId, input.staffAccountId, this.now()],
      );
      if (!bound.rowCount) throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
      await client.query('COMMIT');
      return { expiresAt: row.expires_at.toISOString() };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new CustomerIdentityError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(input: { token: string; accountId: string }): Promise<void> {
    if (!isCustomerIdentityToken(input.token)) throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
    await this.pool.query(
      `UPDATE customer_identity_tokens SET revoked_at = $3
       WHERE token_hash = $1 AND customer_account_id = $2 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [hashCustomerIdentityToken(input.token), input.accountId, this.now()],
    );
  }
}
