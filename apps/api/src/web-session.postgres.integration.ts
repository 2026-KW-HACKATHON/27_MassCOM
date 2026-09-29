import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAuthSessionService } from './postgres/auth-session.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresWebSessionStore } from './postgres/web-session.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try {
    return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
  } catch { return false; }
})();
const hmacSecret = 'web-session-disposable-lifecycle-key-at-least-32-bytes';

async function withPool(run: (pool: Pool) => Promise<void>) {
  const pool = new Pool({ connectionString: testUrl });
  try { await runMigrations(pool); await run(pool); } finally { await pool.end(); }
}

async function identity(pool: Pool, accountId: string) {
  await pool.query(
    `INSERT INTO auth_identities(provider, subject, account_id, created_at)
     VALUES ('google', $1, $2, now())`,
    [`subject-${accountId}`, accountId],
  );
}

test('web sessions hash tokens, separate A/B, revoke one, and expire without sharing mobile bearer state', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => withPool(async (pool) => {
  const accountA = `web-a-${randomUUID()}`;
  const accountB = `web-b-${randomUUID()}`;
  await identity(pool, accountA);
  await identity(pool, accountB);
  let now = new Date('2026-09-24T12:00:00.000Z');
  const tokenA = randomBytes(32).toString('base64url');
  const tokenB = randomBytes(32).toString('base64url');
  const queue = [tokenA, tokenB];
  const store = new PostgresWebSessionStore(pool, {
    hmacSecret, ttlMs: 60_000, now: () => now,
    nextToken: () => queue.shift()!, nextSessionId: randomUUID,
  });
  assert.equal((await store.create(accountA, 'masscom.kr')).token, tokenA);
  assert.equal((await store.create(accountB, 'www.masscom.kr')).token, tokenB);
  const row = await pool.query<{ token_hash: Buffer; origin_host: string }>(
    'SELECT token_hash, origin_host FROM web_sessions WHERE account_id = $1', [accountA],
  );
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0]?.origin_host, 'masscom.kr');
  assert.equal(row.rows[0]?.token_hash.toString('hex'), createHash('sha256').update(tokenA).digest('hex'));
  assert.notEqual(row.rows[0]?.token_hash.toString(), tokenA);
  assert.equal(await store.resolve(tokenA, 'masscom.kr'), accountA);
  await assert.rejects(store.resolve(tokenA, 'www.masscom.kr'), /WEB_SESSION_INVALID/);
  assert.equal(await store.resolve(tokenB, 'www.masscom.kr'), accountB);
  await assert.rejects(store.resolve(tokenB, 'masscom.kr'), /WEB_SESSION_INVALID/);
  const mobile = new PostgresAuthSessionService(pool, {
    verifier: { verify: async () => ({ subject: `subject-${accountA}`, authTime: now }) },
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret }),
    now: () => now,
  });
  await assert.rejects(mobile.resolve(tokenA), /SESSION_INVALID/);
  const mobileSession = await mobile.signInWithGoogle('verified-by-test-verifier');
  await mobile.logout(mobileSession.sessionToken);
  assert.equal(await store.resolve(tokenA, 'masscom.kr'), accountA);
  await assert.rejects(store.resolve('not-a-session', 'masscom.kr'), /WEB_SESSION_INVALID/);
  const mobileRows = await pool.query(
    'SELECT count(*)::int AS total FROM auth_sessions WHERE token_hash = $1',
    [createHash('sha256').update(tokenA).digest()],
  );
  assert.equal(mobileRows.rows[0]?.total, 0);
  await store.revoke(tokenA, 'www.masscom.kr');
  assert.equal(await store.resolve(tokenA, 'masscom.kr'), accountA);
  await store.revoke(tokenA, 'masscom.kr');
  await assert.rejects(store.resolve(tokenA, 'masscom.kr'), /WEB_SESSION_INVALID/);
  assert.equal(await store.resolve(tokenB, 'www.masscom.kr'), accountB);
  now = new Date('2026-09-24T12:01:01.000Z');
  await assert.rejects(store.resolve(tokenB, 'www.masscom.kr'), /WEB_SESSION_INVALID/);
}));

test('resolveWithAge measures a login against the store clock, per session, and keeps the origin and revocation rules', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => withPool(async (pool) => {
  const accountId = `web-age-${randomUUID()}`;
  await identity(pool, accountId);
  const minute = 60_000;
  const start = new Date('2026-09-30T00:00:00.000Z');
  let now = start;
  const issued = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  const store = new PostgresWebSessionStore(pool, {
    hmacSecret, ttlMs: 24 * 60 * minute, now: () => now,
    nextToken: () => issued.shift()!, nextSessionId: randomUUID,
  });
  const old = await store.create(accountId, 'masscom.kr');
  assert.deepEqual(await store.resolveWithAge(old.token, 'masscom.kr'), { accountId, ageMs: 0 });
  now = new Date(start.getTime() + 9 * minute);
  assert.equal((await store.resolveWithAge(old.token, 'masscom.kr')).ageMs, 9 * minute);
  now = new Date(start.getTime() + 11 * minute);
  assert.equal((await store.resolveWithAge(old.token, 'masscom.kr')).ageMs, 11 * minute);
  // A new login is a new session with its own age; the older session keeps growing older.
  const fresh = await store.create(accountId, 'masscom.kr');
  now = new Date(start.getTime() + 15 * minute);
  assert.equal((await store.resolveWithAge(fresh.token, 'masscom.kr')).ageMs, 4 * minute);
  assert.equal((await store.resolveWithAge(old.token, 'masscom.kr')).ageMs, 15 * minute);
  // `resolve` still answers with the account alone.
  assert.equal(await store.resolve(old.token, 'masscom.kr'), accountId);
  await assert.rejects(store.resolveWithAge(old.token, 'www.masscom.kr'), /WEB_SESSION_INVALID/);
  await assert.rejects(store.resolveWithAge('not-a-session', 'masscom.kr'), /WEB_SESSION_INVALID/);
  // A clock that runs behind the database row never yields a negative age.
  now = new Date(start.getTime() - minute);
  assert.equal((await store.resolveWithAge(old.token, 'masscom.kr')).ageMs, 0);
  await store.revoke(fresh.token, 'masscom.kr');
  await assert.rejects(store.resolveWithAge(fresh.token, 'masscom.kr'), /WEB_SESSION_INVALID/);
}));

test('account deletion deletes every web session, leaves no row with the raw account ID and blocks a racing new login', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => withPool(async (pool) => {
  const accountId = `web-delete-${randomUUID()}`;
  await identity(pool, accountId);
  const issued = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  const store = new PostgresWebSessionStore(pool, {
    hmacSecret, ttlMs: 60_000, now: () => new Date('2026-09-24T12:00:00.000Z'),
    nextToken: () => issued.shift()!, nextSessionId: randomUUID,
  });
  const first = await store.create(accountId, 'masscom.kr');
  const second = await store.create(accountId, 'www.masscom.kr');
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret, policyVersion: 'account-deletion-v1',
    now: () => new Date('2026-09-24T12:00:01.000Z'),
  });
  await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
  await assert.rejects(store.resolve(first.token, 'masscom.kr'), /WEB_SESSION_INVALID/);
  await assert.rejects(store.resolve(second.token, 'www.masscom.kr'), /WEB_SESSION_INVALID/);
  // Deleted, not revoked: a revoked row would keep the raw account ID after the deletion.
  const remaining = await pool.query<{ total: number }>(
    'SELECT count(*)::int AS total FROM web_sessions WHERE account_id = $1',
    [accountId],
  );
  assert.equal(remaining.rows[0]?.total, 0);
  await assert.rejects(store.resolveWithAge(first.token, 'masscom.kr'), /WEB_SESSION_INVALID/);
  await assert.rejects(store.create(accountId, 'masscom.kr'), /ACCOUNT_DELETED/);

  const racingId = `web-race-${randomUUID()}`;
  await identity(pool, racingId);
  const blocker = await pool.connect();
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  try {
    await blocker.query('BEGIN');
    const referenceHash = await lifecycle.lockForDeletion(blocker, racingId);
    const outcome = store.create(racingId, 'masscom.kr').then(
      () => ({ error: undefined }), (error: unknown) => ({ error }),
    );
    await new Promise((done) => setTimeout(done, 40));
    await blocker.query(
      `INSERT INTO account_deletion_requests
       (id, account_reference_hash, deleted_account_alias, status, policy_version,
        cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts,
        requested_at, completed_at, updated_at)
       VALUES ($1, $2, $3, 'COMPLETED', 'test-policy', 0, 0, 0,
               now(), now(), now())`,
      [randomUUID(), referenceHash, `deleted:${referenceHash.toString('hex')}`],
    );
    await blocker.query('COMMIT');
    assert.match(String((await outcome).error), /ACCOUNT_DELETED/);
  } finally {
    await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
  }
}));
