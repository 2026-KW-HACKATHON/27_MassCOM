import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { AuthSessionError } from './auth-session.js';
import { GoogleIdTokenError } from './google-id-token.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAuthSessionService } from './postgres/auth-session.js';
import { runMigrations } from './postgres/migrate.js';

const lifecycleSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
const signInAt = new Date('2026-09-21T00:00:00.000Z');

// The fake verifier stands in for Google: the ID token is just a subject marker.
function fakeVerifier(now: () => Date): {
  verify(idToken: string): Promise<{ subject: string; authTime: Date }>;
} {
  return {
    verify: async (idToken: string) => {
      if (!idToken.startsWith('subject:')) throw new GoogleIdTokenError('ID_TOKEN_INVALID');
      return { subject: idToken.slice('subject:'.length), authTime: now() };
    },
  };
}

function sessionService(
  pool: Pool,
  now: () => Date = () => signInAt,
  verifier: { verify(idToken: string): Promise<{ subject: string; authTime?: Date }> } = fakeVerifier(now),
  cleanupBatchSize?: number,
): PostgresAuthSessionService {
  return new PostgresAuthSessionService(pool, {
    verifier,
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret: lifecycleSecret }),
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    now,
    ...(cleanupBatchSize === undefined ? {} : { cleanupBatchSize }),
  });
}

async function freshPool(t: { after(fn: () => unknown): void }): Promise<Pool> {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE auth_sessions, auth_identities CASCADE');
  return pool;
}

test('sign-in creates an identity and a session while storing only the token hash', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool);

  const session = await service.signInWithGoogle('subject:google-user-1');

  assert.ok(session.accountId.startsWith('acct_'));
  assert.notEqual(session.accountId, 'google-user-1');
  assert.equal(session.expiresAt, new Date(signInAt.getTime() + 30 * 24 * 3_600_000).toISOString());

  const identity = await pool.query<{ provider: string; account_id: string }>(
    'SELECT provider, account_id FROM auth_identities WHERE subject = $1',
    ['google-user-1'],
  );
  assert.deepEqual(identity.rows, [{ provider: 'google', account_id: session.accountId }]);

  const stored = await pool.query<{ token_hash: Buffer; revoked_at: Date | null }>(
    'SELECT token_hash, revoked_at FROM auth_sessions WHERE account_id = $1',
    [session.accountId],
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0]!.revoked_at, null);
  assert.deepEqual(
    stored.rows[0]!.token_hash,
    createHash('sha256').update(session.sessionToken).digest(),
  );
});

test('a second sign-in for the same Google subject reuses the account and issues a new session', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool);

  const first = await service.signInWithGoogle('subject:google-user-1');
  const second = await service.signInWithGoogle('subject:google-user-1');

  assert.equal(second.accountId, first.accountId);
  assert.notEqual(second.sessionToken, first.sessionToken);
  assert.equal(await service.resolve(first.sessionToken), first.accountId);
  assert.equal(await service.resolve(second.sessionToken), first.accountId);
});

test('showcase invite guard rejects uninvited Google subjects before any account or session write', async (t) => {
  const pool = await freshPool(t);
  const invitedHash = createHash('sha256').update('invited-google-subject').digest('hex');
  const service = new PostgresAuthSessionService(pool, {
    verifier: fakeVerifier(() => signInAt),
    allowedSubjectHashes: new Set([invitedHash]),
    now: () => signInAt,
  });

  await assert.rejects(service.signInWithGoogle('subject:outsider'), (error: unknown) =>
    error instanceof AuthSessionError && error.code === 'INVITE_REQUIRED');
  const counts = await pool.query<{ identities: string; sessions: string }>(
    `SELECT (SELECT count(*) FROM auth_identities)::text AS identities,
            (SELECT count(*) FROM auth_sessions)::text AS sessions`,
  );
  assert.deepEqual(counts.rows[0], { identities: '0', sessions: '0' });

  const invited = await service.signInWithGoogle('subject:invited-google-subject');
  assert.equal(await service.resolve(invited.sessionToken), invited.accountId);
});

test('showcase invite removal blocks an old session without changing normal production sessions', async (t) => {
  const pool = await freshPool(t);
  const invitedHash = createHash('sha256').update('invited-google-subject').digest('hex');
  const service = new PostgresAuthSessionService(pool, {
    verifier: fakeVerifier(() => signInAt),
    allowedSubjectHashes: new Set([invitedHash]),
    now: () => signInAt,
  });
  const invited = await service.signInWithGoogle('subject:invited-google-subject');
  const removed = new PostgresAuthSessionService(pool, {
    verifier: fakeVerifier(() => signInAt),
    allowedSubjectHashes: new Set(['f'.repeat(64)]),
    now: () => signInAt,
  });
  await assert.rejects(removed.resolve(invited.sessionToken), (error: unknown) =>
    error instanceof AuthSessionError && error.code === 'INVITE_REQUIRED');
  assert.equal(await sessionService(pool).resolve(invited.sessionToken), invited.accountId);
});

test('resolve rejects unknown, expired and revoked session tokens', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool);
  const session = await service.signInWithGoogle('subject:google-user-1');

  await assert.rejects(
    service.resolve('not-a-real-session-token'),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
  );

  const afterExpiry = sessionService(
    pool,
    () => new Date(signInAt.getTime() + 31 * 24 * 3_600_000),
  );
  await assert.rejects(
    afterExpiry.resolve(session.sessionToken),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
  );

  await service.logout(session.sessionToken);
  await assert.rejects(
    service.resolve(session.sessionToken),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
  );
});

test('logout revokes only the session that presented the token', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool);
  const phone = await service.signInWithGoogle('subject:google-user-1');
  const laptop = await service.signInWithGoogle('subject:google-user-1');

  await service.logout(phone.sessionToken);

  await assert.rejects(
    service.resolve(phone.sessionToken),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
  );
  assert.equal(await service.resolve(laptop.sessionToken), laptop.accountId);
});

test('reauthentication refreshes the recency window only for the session own identity', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool);
  const session = await service.signInWithGoogle('subject:google-user-1');
  await service.signInWithGoogle('subject:google-user-2');

  const muchLater = sessionService(pool, () => new Date(signInAt.getTime() + 60 * 60 * 1000));
  await assert.rejects(
    muchLater.assertRecentlyAuthenticated(session.sessionToken),
    (error: unknown) =>
      error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED',
  );
  await assert.rejects(
    muchLater.reauthenticate(session.sessionToken, 'subject:google-user-2'),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'IDENTITY_MISMATCH',
  );

  await muchLater.reauthenticate(session.sessionToken, 'subject:google-user-1');
  assert.equal(
    await muchLater.assertRecentlyAuthenticated(session.sessionToken),
    session.accountId,
  );
});

test('reauthentication rejects a missing or stale Google authentication time', async (t) => {
  const pool = await freshPool(t);
  const session = await sessionService(pool).signInWithGoogle('subject:google-user-1');
  const now = new Date(signInAt.getTime() + 60 * 60 * 1000);

  for (const authTime of [undefined, signInAt]) {
    const service = sessionService(pool, () => now, {
      verify: async () => ({ subject: 'google-user-1', ...(authTime ? { authTime } : {}) }),
    });
    await assert.rejects(
      service.reauthenticate(session.sessionToken, 'unused-token'),
      (error: unknown) =>
        error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED',
    );
  }
});

test('sign-in without Google authentication time does not grant recent-authentication privilege', async (t) => {
  const pool = await freshPool(t);
  const service = sessionService(pool, () => signInAt, {
    verify: async () => ({ subject: 'google-user-without-auth-time' }),
  });
  const session = await service.signInWithGoogle('unused-token');

  await assert.rejects(
    service.assertRecentlyAuthenticated(session.sessionToken),
    (error: unknown) =>
      error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED',
  );
});

test('successful sign-in removes only one bounded batch of expired or revoked sessions', async (t) => {
  const pool = await freshPool(t);
  await pool.query(
    `INSERT INTO auth_sessions (
       id, account_id, token_hash, created_at, expires_at, last_authenticated_at, revoked_at
     ) VALUES
       ('10000000-0000-4000-8000-000000000001', 'stale-1', decode(repeat('11', 32), 'hex'), $1, $1, $1, NULL),
       ('10000000-0000-4000-8000-000000000002', 'stale-2', decode(repeat('22', 32), 'hex'), $1, $2, $1, $1),
       ('10000000-0000-4000-8000-000000000003', 'stale-3', decode(repeat('33', 32), 'hex'), $1, $1, $1, NULL),
       ('10000000-0000-4000-8000-000000000004', 'active-1', decode(repeat('44', 32), 'hex'), $1, $2, $1, NULL)`,
    [new Date(signInAt.getTime() - 1), new Date(signInAt.getTime() + 60_000)],
  );

  await sessionService(pool, () => signInAt, fakeVerifier(() => signInAt), 2).signInWithGoogle(
    'subject:cleanup-user',
  );

  const remaining = await pool.query<{ stale: number; active: number }>(
    `SELECT
       count(*) FILTER (WHERE expires_at <= $1 OR revoked_at IS NOT NULL)::integer AS stale,
       count(*) FILTER (WHERE expires_at > $1 AND revoked_at IS NULL)::integer AS active
     FROM auth_sessions`,
    [signInAt],
  );
  assert.deepEqual(remaining.rows[0], { stale: 1, active: 2 });

  const indexes = await pool.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'auth_sessions'
       AND indexname IN ('auth_sessions_expires_at', 'auth_sessions_revoked_at')
     ORDER BY indexname`,
  );
  assert.deepEqual(indexes.rows.map((row) => row.indexname), [
    'auth_sessions_expires_at',
    'auth_sessions_revoked_at',
  ]);
});

test('account deletion needs recent authentication, then revokes every session and the identity', async (t) => {
  const pool = await freshPool(t);
  await pool.query('TRUNCATE account_deletion_requests CASCADE');
  const service = sessionService(pool);
  const session = await service.signInWithGoogle('subject:google-user-1');
  const otherDevice = await service.signInWithGoogle('subject:google-user-1');

  const staleNow = new Date(signInAt.getTime() + 60 * 60 * 1000);
  const stale = sessionService(pool, () => staleNow);
  await assert.rejects(
    stale.assertRecentlyAuthenticated(session.sessionToken),
    (error: unknown) =>
      error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED',
  );

  await stale.reauthenticate(session.sessionToken, 'subject:google-user-1');
  const accountId = await stale.assertRecentlyAuthenticated(session.sessionToken);

  const deletions = new PostgresAccountDeletionService(pool, {
    hmacSecret: lifecycleSecret,
    policyVersion: 'account-deletion-v1',
    now: () => staleNow,
  });
  const deletion = await deletions.requestDeletion({
    accountId,
    confirmation: 'DELETE MY ACCOUNT',
  });
  assert.equal(deletion.status, 'COMPLETED');

  for (const revoked of [session, otherDevice]) {
    await assert.rejects(
      stale.resolve(revoked.sessionToken),
      (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
    );
  }
  const identities = await pool.query('SELECT 1 FROM auth_identities WHERE account_id = $1', [
    accountId,
  ]);
  assert.equal(identities.rowCount, 0);

  const returning = await stale.signInWithGoogle('subject:google-user-1');
  assert.notEqual(returning.accountId, accountId);
  assert.equal(await stale.resolve(returning.sessionToken), returning.accountId);
});

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}
