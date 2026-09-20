import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  AuthSessionError,
  type AuthSessionService,
  type IssuedSession,
} from '../auth-session.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

type IdTokenVerifier = {
  verify(idToken: string): Promise<{ subject: string }>;
};

type Options = {
  verifier: IdTokenVerifier;
  sessionTtlMs: number;
  reauthenticationWindowMs: number;
  nextSessionId: () => string;
  nextAccountId: () => string;
  nextSessionToken: () => string;
  now: () => Date;
  accountLifecycle?: PostgresAccountLifecycle;
};

type ServiceOptions = Pick<Options, 'verifier'> & Partial<Options>;

type SessionRow = {
  account_id: string;
  last_authenticated_at: Date;
};

const defaultOptions = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  reauthenticationWindowMs: 5 * 60 * 1000,
  nextSessionId: () => randomUUID(),
  // Opaque and unrelated to the Google subject, so the account id leaks no identity.
  nextAccountId: () => `acct_${randomUUID()}`,
  nextSessionToken: () => randomBytes(32).toString('base64url'),
  now: () => new Date(),
};

export class PostgresAuthSessionService implements AuthSessionService {
  private readonly options: Options;

  constructor(
    private readonly pool: Pool,
    options: ServiceOptions,
  ) {
    this.options = { ...defaultOptions, ...options };
    if (this.options.sessionTtlMs <= 0) {
      throw new Error('auth session TTL must be positive');
    }
  }

  async signInWithGoogle(idToken: string): Promise<IssuedSession> {
    const { subject } = await this.options.verifier.verify(idToken);
    const now = this.options.now();
    const sessionToken = this.options.nextSessionToken();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlMs);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const accountId = await findOrCreateAccountId(
        client,
        subject,
        this.options.nextAccountId(),
        now,
      );
      await client.query(
        `INSERT INTO auth_sessions (
           id, account_id, token_hash, created_at, expires_at, last_authenticated_at
         ) VALUES ($1, $2, $3, $4, $5, $4)`,
        [this.options.nextSessionId(), accountId, tokenHash(sessionToken), now, expiresAt],
      );
      await client.query('COMMIT');
      return { sessionToken, accountId, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolve(sessionToken: string): Promise<string> {
    const client = await this.pool.connect();
    try {
      const session = await activeSession(client, sessionToken, this.options.now());
      await this.assertAccountActive(client, session.account_id);
      return session.account_id;
    } finally {
      client.release();
    }
  }

  async logout(sessionToken: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
      [this.options.now(), tokenHash(sessionToken)],
    );
  }

  async reauthenticate(sessionToken: string, idToken: string): Promise<void> {
    const { subject } = await this.options.verifier.verify(idToken);
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      const session = await activeSession(client, sessionToken, now);
      await this.assertAccountActive(client, session.account_id);
      const owner = await client.query<{ account_id: string }>(
        `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`,
        [subject],
      );
      if (owner.rows[0]?.account_id !== session.account_id) {
        throw new AuthSessionError('IDENTITY_MISMATCH');
      }
      await client.query(
        'UPDATE auth_sessions SET last_authenticated_at = $1 WHERE token_hash = $2',
        [now, tokenHash(sessionToken)],
      );
    } finally {
      client.release();
    }
  }

  async assertRecentlyAuthenticated(
    sessionToken: string,
    windowMs = this.options.reauthenticationWindowMs,
  ): Promise<string> {
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      const session = await activeSession(client, sessionToken, now);
      await this.assertAccountActive(client, session.account_id);
      if (session.last_authenticated_at.getTime() < now.getTime() - windowMs) {
        throw new AuthSessionError('REAUTHENTICATION_REQUIRED');
      }
      return session.account_id;
    } finally {
      client.release();
    }
  }

  private async assertAccountActive(client: PoolClient, accountId: string): Promise<void> {
    if (!this.options.accountLifecycle) return;
    try {
      await this.options.accountLifecycle.assertActive(client, accountId);
    } catch (error) {
      if (error instanceof AccountLifecycleError) throw new AuthSessionError('SESSION_INVALID');
      throw error;
    }
  }
}

async function findOrCreateAccountId(
  client: PoolClient,
  subject: string,
  candidateAccountId: string,
  now: Date,
): Promise<string> {
  const inserted = await client.query<{ account_id: string }>(
    `INSERT INTO auth_identities (provider, subject, account_id, created_at)
     VALUES ('google', $1, $2, $3)
     ON CONFLICT (provider, subject) DO NOTHING
     RETURNING account_id`,
    [subject, candidateAccountId, now],
  );
  if (inserted.rows[0]) return inserted.rows[0].account_id;

  const existing = await client.query<{ account_id: string }>(
    `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`,
    [subject],
  );
  const accountId = existing.rows[0]?.account_id;
  if (!accountId) throw new AuthSessionError('SESSION_INVALID');
  return accountId;
}

async function activeSession(
  client: PoolClient,
  sessionToken: string,
  now: Date,
): Promise<SessionRow> {
  if (!sessionToken.trim()) throw new AuthSessionError('SESSION_REQUIRED');
  const session = (
    await client.query<SessionRow>(
      `SELECT account_id, last_authenticated_at
       FROM auth_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
      [tokenHash(sessionToken), now],
    )
  ).rows[0];
  if (!session) throw new AuthSessionError('SESSION_INVALID');
  return session;
}

// Only the digest is persisted, so a database leak cannot replay a live session.
function tokenHash(sessionToken: string): Buffer {
  return createHash('sha256').update(sessionToken).digest();
}
