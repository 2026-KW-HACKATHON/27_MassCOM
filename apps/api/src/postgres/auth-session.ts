import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  AuthSessionError,
  type AuthSessionService,
  type IssuedSession,
} from '../auth-session.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

type IdTokenVerifier = {
  verify(idToken: string): Promise<{ subject: string; authTime?: Date }>;
};

type Options = {
  verifier: IdTokenVerifier;
  sessionTtlMs: number;
  reauthenticationWindowMs: number;
  nextSessionId: () => string;
  nextAccountId: () => string;
  nextSessionToken: () => string;
  now: () => Date;
  cleanupBatchSize: number;
  accountLifecycle?: PostgresAccountLifecycle;
  allowedSubjectHashes?: ReadonlySet<string>;
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
  cleanupBatchSize: 100,
};

export class PostgresAuthSessionService implements AuthSessionService {
  private readonly options: Options;

  constructor(
    private readonly pool: Pool,
    options: ServiceOptions,
  ) {
    this.options = { ...defaultOptions, ...options };
    if (!Number.isFinite(this.options.sessionTtlMs) || this.options.sessionTtlMs <= 0) {
      throw new Error('auth session TTL must be positive');
    }
    if (!Number.isSafeInteger(this.options.cleanupBatchSize) || this.options.cleanupBatchSize <= 0) {
      throw new Error('auth session cleanup batch size must be a positive safe integer');
    }
    if (this.options.allowedSubjectHashes && (
      this.options.allowedSubjectHashes.size === 0 ||
      [...this.options.allowedSubjectHashes].some((value) => !/^[0-9a-f]{64}$/.test(value))
    )) {
      throw new Error('showcase invited Google subject hashes must be nonempty SHA-256 values');
    }
  }

  async signInWithGoogle(idToken: string): Promise<IssuedSession> {
    const { subject, authTime } = await this.options.verifier.verify(idToken);
    if (!this.isInvited(subject)) throw new AuthSessionError('INVITE_REQUIRED');
    const now = this.options.now();
    const sessionToken = this.options.nextSessionToken();
    const expiresAt = new Date(now.getTime() + this.options.sessionTtlMs);
    // A valid ID token can be obtained silently. Without Google's auth_time it creates a usable
    // session, but must not grant the separate recent-user-presence privilege used for deletion.
    const lastAuthenticatedAt = authTime ?? new Date(0);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await cleanupStaleSessions(client, now, this.options.cleanupBatchSize);
      const accountId = await findOrCreateAccountId(
        client,
        subject,
        this.options.nextAccountId(),
        now,
      );
      await client.query(
        `INSERT INTO auth_sessions (
           id, account_id, token_hash, created_at, expires_at, last_authenticated_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          this.options.nextSessionId(),
          accountId,
          tokenHash(sessionToken),
          now,
          expiresAt,
          lastAuthenticatedAt,
        ],
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
      await this.assertAccountInvited(client, session.account_id);
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
    const { subject, authTime } = await this.options.verifier.verify(idToken);
    const now = this.options.now();
    if (
      !authTime ||
      authTime.getTime() < now.getTime() - this.options.reauthenticationWindowMs
    ) {
      throw new AuthSessionError('REAUTHENTICATION_REQUIRED');
    }
    const client = await this.pool.connect();
    try {
      const session = await activeSession(client, sessionToken, now);
      await this.assertAccountInvited(client, session.account_id);
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
      await this.assertAccountInvited(client, session.account_id);
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

  private isInvited(subject: string): boolean {
    return !this.options.allowedSubjectHashes || this.options.allowedSubjectHashes.has(
      createHash('sha256').update(subject).digest('hex'),
    );
  }

  private async assertAccountInvited(client: PoolClient, accountId: string): Promise<void> {
    if (!this.options.allowedSubjectHashes) return;
    const identity = await client.query<{ subject: string }>(
      `SELECT subject FROM auth_identities
       WHERE provider = 'google' AND account_id = $1`,
      [accountId],
    );
    if (!identity.rows[0] || !this.isInvited(identity.rows[0].subject)) {
      throw new AuthSessionError('INVITE_REQUIRED');
    }
  }
}

async function cleanupStaleSessions(
  client: PoolClient,
  now: Date,
  batchSize: number,
): Promise<void> {
  await client.query(
    `WITH stale AS (
       SELECT id
       FROM auth_sessions
       WHERE expires_at <= $1 OR revoked_at IS NOT NULL
       ORDER BY coalesce(revoked_at, expires_at), id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     DELETE FROM auth_sessions AS session
     USING stale
     WHERE session.id = stale.id`,
    [now, batchSize],
  );
}

async function findOrCreateAccountId(
  client: PoolClient,
  subject: string,
  candidateAccountId: string,
  now: Date,
): Promise<string> {
  // DO UPDATE (a no-op) instead of DO NOTHING so the statement always returns the winning row,
  // even when a concurrent first sign-in for the same subject commits or aborts in between.
  const identity = await client.query<{ account_id: string }>(
    `INSERT INTO auth_identities (provider, subject, account_id, created_at)
     VALUES ('google', $1, $2, $3)
     ON CONFLICT (provider, subject) DO UPDATE SET account_id = auth_identities.account_id
     RETURNING account_id`,
    [subject, candidateAccountId, now],
  );
  return identity.rows[0]!.account_id;
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
