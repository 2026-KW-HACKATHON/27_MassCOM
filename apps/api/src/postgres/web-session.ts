import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

import { WebSessionError } from '../web-session.js';
import type { WebOriginHost } from '../web-origin.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

type Options = {
  hmacSecret: string;
  ttlMs: number;
  now?: () => Date;
  nextToken?: () => string;
  nextSessionId?: () => string;
};

function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export class PostgresWebSessionStore {
  private readonly now: () => Date;
  private readonly nextToken: () => string;
  private readonly nextSessionId: () => string;
  private readonly lifecycle: PostgresAccountLifecycle;

  constructor(
    private readonly pool: Pool,
    private readonly options: Options,
  ) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0 || options.ttlMs > 24 * 60 * 60 * 1000) {
      throw new Error('WEB_SESSION_TTL_INVALID');
    }
    this.now = options.now ?? (() => new Date());
    this.nextToken = options.nextToken ?? (() => randomBytes(32).toString('base64url'));
    this.nextSessionId = options.nextSessionId ?? randomUUID;
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret: options.hmacSecret });
  }

  async create(accountId: string, originHost: WebOriginHost): Promise<{ token: string; expiresAt: Date }> {
    if (!accountId.trim()) throw new WebSessionError('WEB_SESSION_ACCOUNT_REQUIRED');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lifecycle.assertActive(client, accountId);
      const identity = await client.query(
        `SELECT 1 FROM auth_identities WHERE provider = 'google' AND account_id = $1`,
        [accountId],
      );
      if (identity.rowCount !== 1) throw new WebSessionError('WEB_SESSION_ACCOUNT_REQUIRED');
      const token = this.nextToken();
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('WEB_SESSION_TOKEN_INVALID');
      const now = this.now();
      const expiresAt = new Date(now.getTime() + this.options.ttlMs);
      await client.query(
        `INSERT INTO web_sessions (id, account_id, token_hash, created_at, expires_at, origin_host)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.nextSessionId(), accountId, tokenHash(token), now, expiresAt, originHost],
      );
      await client.query('COMMIT');
      return { token, expiresAt };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(token: string, originHost: WebOriginHost): Promise<string> {
    return (await this.lookup(token, originHost)).accountId;
  }

  /**
   * The session's age is measured against this store's clock, the same one that stamped `created_at`, so the caller
   * can require a recent login without trusting a browser value. A `created_at` in the future counts as age 0.
   */
  async resolveWithAge(token: string, originHost: WebOriginHost): Promise<{ accountId: string; ageMs: number }> {
    const { accountId, createdAt, now } = await this.lookup(token, originHost);
    return { accountId, ageMs: Math.max(0, now.getTime() - createdAt.getTime()) };
  }

  private async lookup(
    token: string,
    originHost: WebOriginHost,
  ): Promise<{ accountId: string; createdAt: Date; now: Date }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new WebSessionError('WEB_SESSION_INVALID');
    const client = await this.pool.connect();
    try {
      const now = this.now();
      const result = await client.query<{ account_id: string; created_at: Date }>(
        `SELECT account_id, created_at FROM web_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2 AND origin_host = $3`,
        [tokenHash(token), now, originHost],
      );
      const row = result.rows[0];
      if (!row?.account_id) throw new WebSessionError('WEB_SESSION_INVALID');
      try {
        await this.lifecycle.assertActive(client, row.account_id);
      } catch (error) {
        if (error instanceof AccountLifecycleError) throw new WebSessionError('WEB_SESSION_INVALID');
        throw error;
      }
      return { accountId: row.account_id, createdAt: row.created_at, now };
    } finally {
      client.release();
    }
  }

  async revoke(token: string, originHost: WebOriginHost): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.pool.query(
      `UPDATE web_sessions SET revoked_at = $1
       WHERE token_hash = $2 AND revoked_at IS NULL AND origin_host = $3`,
      [this.now(), tokenHash(token), originHost],
    );
  }
}
