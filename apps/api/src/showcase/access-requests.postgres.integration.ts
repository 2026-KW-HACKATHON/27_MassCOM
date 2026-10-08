import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { Pool } from 'pg';

import { photoProject } from '../collectible-project-test-support.js';
import { runMigrations } from '../postgres/migrate.js';
import { PostgresAccountDeletionService } from '../postgres/account-deletion.js';
import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { PostgresMerchantAccessControl } from '../postgres/merchant-access.js';
import { requireActiveMerchantMember } from '../postgres/merchant-membership.js';
import { PostgresCollectibleProjectService } from '../postgres/collectible-project.js';
import { seedLocalShowcase, SHOWCASE_PRACTICE_MERCHANT_ID } from './local-seed.js';
import { WOLGYE_STORES } from './wolgye-seed.js';
import { ShowcaseAccessRequestError, ShowcaseAccessRequestService } from './access-requests.js';

const execFileAsync = promisify(execFile);

const secret = 'test-only-access-request-secret-at-least-32-bytes-long';

/** A fresh masscom_showcase_ci_<uuid>_test database, migrated and seeded with the real stores and a private practice merchant. */
async function withFreshShowcaseDatabase(run: (pool: Pool, url: URL) => Promise<void>): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must end in _test');
  }
  const admin = new Pool({ connectionString });
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      await runMigrations(pool);
      await seedLocalShowcase(pool);
      await run(pool, url);
    } finally {
      await pool.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
}

async function requestIdFor(pool: Pool, code: string): Promise<string> {
  const row = await pool.query<{ id: string }>('SELECT id FROM showcase_access_requests WHERE code = $1', [code]);
  return row.rows[0]!.id;
}

/**
 * Polls `pg_stat_activity` (a separate connection, never the contenders' own) until at least `count` distinct
 * backends of this fixture's database are actually blocked waiting on *some* lock, instead of sleeping a fixed
 * guess. A contender can be blocked on either kind of lock these fixtures race (the request row's `FOR UPDATE`,
 * or an account's `pg_advisory_xact_lock`), so this does not filter by query text. Used to know every contender
 * has truly queued up before releasing whatever holds the lock, so a reverted lock-order fix reliably deadlocks
 * (40P01) here instead of only flaking (#304 P2).
 */
async function waitForBlockedBackends(pool: Pool, count: number): Promise<void> {
  const monitor = await pool.connect();
  try {
    const deadline = Date.now() + 5000;
    let waiting = 0;
    while (waiting < count && Date.now() < deadline) {
      const activity = await monitor.query<{ total: number }>(
        `SELECT count(DISTINCT pid)::int AS total FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database() AND pid <> pg_backend_pid()`,
      );
      waiting = activity.rows[0]!.total;
      if (waiting < count) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(waiting >= count, `expected ${count} backend(s) blocked on a lock, saw ${waiting}`);
  } finally {
    monitor.release();
  }
}

/**
 * Holds the request row's lock on a side connection so `first` and then `second` reliably queue up waiting for it,
 * `first` entering the queue before `second` — then releases it once both are confirmed blocked (#304 P2).
 */
async function raceOnRequestRow<A, B>(
  pool: Pool,
  requestId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM showcase_access_requests WHERE id = $1 FOR UPDATE', [requestId]);
    const firstPromise = first();
    await waitForBlockedBackends(pool, 1);
    const secondPromise = second();
    await waitForBlockedBackends(pool, 2);
    await holder.query('COMMIT');
    return await Promise.allSettled([firstPromise, secondPromise]);
  } finally {
    holder.release();
  }
}

/**
 * Pins account `accountId`'s PostgresAccountLifecycle advisory lock (the same key `assertAllActive` takes) on its
 * own connection until released. Used to force two concurrent `decide()` calls to queue for *both* accounts
 * deterministically instead of racing on timing (#304 P2).
 */
async function holdAccountLock(
  pool: Pool,
  accountLifecycle: PostgresAccountLifecycle,
  accountId: string,
): Promise<{ release: () => Promise<void> }> {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    accountLifecycle.referenceHash(accountId).toString('hex'),
  ]);
  return {
    release: async () => {
      await client.query('COMMIT');
      client.release();
    },
  };
}

async function runGrantApproverCommand(databaseUrl: URL, code: string): Promise<string> {
  const command = fileURLToPath(new URL('./grant-approver-command.ts', import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, ['--import', 'tsx', command, code], {
    env: { ...process.env, DATABASE_URL: databaseUrl.toString(), ACCOUNT_DELETION_HMAC_SECRET: secret },
    encoding: 'utf8',
  });
  return stdout.trim();
}

// grant-approver-command.ts is gated by assertLocalShowcaseDatabaseUrl, which accepts the same loopback database
// names the service itself permits (isPermittedShowcaseDatabaseName): the fixed CLI name and the generated
// masscom_showcase_ci_*_test pattern. This creates a per-run generated name so it never touches a database it did
// not create (#294 P1), and drops only that database afterwards.
async function withFreshLocalShowcaseDatabase(run: (pool: Pool, url: URL) => Promise<void>): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const localUrl = new URL(connectionString);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname)) {
    throw new Error('TEST_DATABASE_URL host is not eligible for the local showcase database name');
  }
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  localUrl.pathname = `/${databaseName}`;
  localUrl.search = '';
  localUrl.hash = '';
  const admin = new Pool({ connectionString });
  let created = false;
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    pool = new Pool({ connectionString: localUrl.toString() });
    await runMigrations(pool);
    await seedLocalShowcase(pool);
    await run(pool, localUrl);
  } finally {
    try {
      await pool?.end();
    } finally {
      if (created) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => {});
      await admin.end();
    }
  }
}

test('a non-showcase database name is refused before any row is written', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const pool = new Pool({ connectionString });
  try {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await assert.rejects(service.request('acct_a'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_HOST_DATABASE_REQUIRED');
    const rows = await pool.query<{ total: number }>('SELECT count(*)::int AS total FROM showcase_access_requests');
    assert.equal(rows.rows[0]?.total, 0);
  } finally {
    await pool.end();
  }
});

test('approval grants STAFF on the private practice store only and records the decision', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);

    const { created, request } = await service.request('acct_customer');
    assert.equal(created, true);
    assert.match(request.code, /^[0-9A-HJKMNP-TV-Z]{8}$/);

    const pending = await service.listPending('acct_admin');
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.code, request.code);

    await service.decide('acct_admin', pending[0]!.id, 'APPROVED');

    const member = await pool.query(
      `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_customer'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.deepEqual(member.rows[0], { role: 'STAFF', status: 'ACTIVE' });
    const otherMembership = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM merchant_members WHERE account_id = 'acct_customer' AND merchant_id <> $1`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(otherMembership.rows[0]?.total, 0, 'approval must not touch any other store');
    assert.equal((await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_customer'`,
      [WOLGYE_STORES[0]!.id],
    )).rowCount, 0, 'approval must not grant access to a real-data store');

    const decided = await pool.query(
      `SELECT status, decided_via, decided_by_account_id FROM showcase_access_requests WHERE account_id = 'acct_customer'`,
    );
    assert.equal(decided.rows[0]?.status, 'APPROVED');
    assert.equal(decided.rows[0]?.decided_via, 'APP');
    assert.equal(decided.rows[0]?.decided_by_account_id, 'acct_admin');

    const mine = await service.mine('acct_customer');
    assert.equal(mine.staff, true);
    assert.equal(mine.practiceMerchantId, SHOWCASE_PRACTICE_MERCHANT_ID);
    assert.equal(mine.trialMerchantId, null);
    assert.equal(mine.request?.status, 'APPROVED');
  });
});

test('a stale membership cannot grant management of a real-data showcase store', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const merchantId = WOLGYE_STORES[0]!.id;
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ($1, 'acct_stale', 'OWNER', 'ACTIVE')`, [merchantId],
    );
    await assert.rejects(new PostgresMerchantAccessControl(pool, { staffMayManageArt: true }).requirePermission({
      accountId: 'acct_stale', merchantId, permission: 'MANAGE_ART',
    }), /MERCHANT_ACCESS_DENIED/);
    await assert.rejects(new PostgresCollectibleProjectService(pool, { staffMayManageArt: true }).create({
      accountId: 'acct_stale', merchantId, project: photoProject('권한 없음'),
    }), /MERCHANT_ACCESS_DENIED/);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await assert.rejects(requireActiveMerchantMember(client, merchantId, 'acct_stale'), /MERCHANT_ACCESS_DENIED/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

test('a non-approver and a self-decision are both rejected, and the request stays PENDING', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_customer');
    const requestId = await requestIdFor(pool, request.code);

    await assert.rejects(service.decide('acct_not_admin', requestId, 'APPROVED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_APPROVER_REQUIRED');

    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_customer')`);
    await assert.rejects(service.decide('acct_customer', requestId, 'APPROVED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_ACCESS_SELF_DECISION');

    const stillPending = await pool.query<{ status: string }>(
      'SELECT status FROM showcase_access_requests WHERE id = $1', [requestId],
    );
    assert.equal(stillPending.rows[0]?.status, 'PENDING');
    const member = await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_customer'`, [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(member.rowCount, 0, 'a rejected decision attempt must never grant STAFF');
  });
});

test('two concurrent requests from the same account leave exactly one PENDING row', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const [first, second] = await Promise.all([service.request('acct_race'), service.request('acct_race')]);
    // The account-lifecycle advisory lock serializes the two transactions: exactly one creates the row.
    assert.notEqual(first.created, second.created);
    assert.equal(first.request.code, second.request.code);
    const rows = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM showcase_access_requests WHERE account_id = 'acct_race' AND status = 'PENDING'`,
    );
    assert.equal(rows.rows[0]?.total, 1);
  });
});

test('rejecting a request lets the same account request again', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);

    const { request: first } = await service.request('acct_customer');
    await service.decide('acct_admin', await requestIdFor(pool, first.code), 'REJECTED');

    const { created, request: second } = await service.request('acct_customer');
    assert.equal(created, true);
    assert.notEqual(second.code, first.code);

    const statuses = await pool.query<{ status: string }>(
      `SELECT status FROM showcase_access_requests WHERE account_id = 'acct_customer' ORDER BY created_at`,
    );
    assert.deepEqual(statuses.rows.map((row) => row.status), ['REJECTED', 'PENDING']);
  });
});

test('account deletion aliases the requester and decider columns instead of leaving the raw account id behind', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);
    const { request } = await service.request('acct_leaving');
    const id = await requestIdFor(pool, request.code);
    await service.decide('acct_admin', id, 'APPROVED');

    const deletions = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-policy' });
    await deletions.requestDeletion({ accountId: 'acct_leaving', confirmation: 'DELETE MY ACCOUNT' });
    const requesterAliased = await pool.query<{ account_id: string }>(
      'SELECT account_id FROM showcase_access_requests WHERE id = $1', [id],
    );
    assert.notEqual(requesterAliased.rows[0]?.account_id, 'acct_leaving');
    assert.match(requesterAliased.rows[0]?.account_id ?? '', /^deleted:[0-9a-f]+$/);

    await deletions.requestDeletion({ accountId: 'acct_admin', confirmation: 'DELETE MY ACCOUNT' });
    const deciderAliased = await pool.query<{ decided_by_account_id: string }>(
      'SELECT decided_by_account_id FROM showcase_access_requests WHERE id = $1', [id],
    );
    assert.notEqual(deciderAliased.rows[0]?.decided_by_account_id, 'acct_admin');
    assert.match(deciderAliased.rows[0]?.decided_by_account_id ?? '', /^deleted:[0-9a-f]+$/);
  });
});

// grant-approver-command.ts is gated by assertLocalShowcaseDatabaseUrl, which accepts the same loopback database
// names the service itself permits (isPermittedShowcaseDatabaseName): the fixed CLI name and the generated
// masscom_showcase_ci_*_test pattern. This test uses a per-run generated name so it never touches a database it
// did not create (#294 P1), and drops only that database afterwards.
test('ops command grants the approver role, audits it with the DB session user, and approves via OPS', async () => {
  await withFreshLocalShowcaseDatabase(async (pool, localUrl) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_future_approver');

    const command = fileURLToPath(new URL('./grant-approver-command.ts', import.meta.url));
    const run = () =>
      execFileSync(process.execPath, ['--import', 'tsx', command, request.code], {
        env: { ...process.env, DATABASE_URL: localUrl.toString(), ACCOUNT_DELETION_HMAC_SECRET: secret },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    assert.equal(run().trim(), 'SHOWCASE_APPROVER_GRANTED');

    const admins = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM platform_admins WHERE account_id = 'acct_future_approver'`,
    );
    assert.equal(admins.rows[0]?.revoked_at, null);
    const audit = await pool.query<{ action: string; db_user: string }>(
      `SELECT action, db_user FROM platform_admin_role_audit WHERE target_account_id = 'acct_future_approver'`,
    );
    assert.equal(audit.rows[0]?.action, 'GRANT');
    assert.ok(audit.rows[0]?.db_user);

    const member = await pool.query(
      `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_future_approver'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.deepEqual(member.rows[0], { role: 'STAFF', status: 'ACTIVE' });

    const decided = await pool.query<{ status: string; decided_via: string; decided_by_account_id: string | null; decided_db_user: string }>(
      'SELECT status, decided_via, decided_by_account_id, decided_db_user FROM showcase_access_requests WHERE code = $1',
      [request.code],
    );
    assert.equal(decided.rows[0]?.status, 'APPROVED');
    assert.equal(decided.rows[0]?.decided_via, 'OPS');
    assert.equal(decided.rows[0]?.decided_by_account_id, null);
    assert.ok(decided.rows[0]?.decided_db_user);

    // The request is no longer PENDING, so running the command again on the same code finds nothing to decide.
    assert.throws(run);
  });
});

test('a revoked approver is rejected by listPending and decide, and decides nothing', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(`INSERT INTO platform_admins (account_id, revoked_at) VALUES ('acct_revoked', now())`);
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_customer');
    const requestId = await requestIdFor(pool, request.code);

    await assert.rejects(service.listPending('acct_revoked'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_APPROVER_REQUIRED');
    await assert.rejects(service.decide('acct_revoked', requestId, 'APPROVED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_APPROVER_REQUIRED');
    await assert.rejects(service.decide('acct_revoked', requestId, 'REJECTED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_APPROVER_REQUIRED');

    const stillPending = await pool.query<{ status: string }>(
      'SELECT status FROM showcase_access_requests WHERE id = $1', [requestId],
    );
    assert.equal(stillPending.rows[0]?.status, 'PENDING');
    const member = await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_customer'`, [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(member.rowCount, 0, 'a revoked approver must never grant STAFF');
  });
});

test('a code generator that always collides is exhausted after 5 attempts and creates nothing', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const collidingCode = 'ABCDEFGH';
    await pool.query(
      `INSERT INTO showcase_access_requests (id, account_id, code) VALUES ($1, 'acct_other', $2)`,
      [randomUUID(), collidingCode],
    );
    const service = new ShowcaseAccessRequestService(pool, {
      accountDeletionHmacSecret: secret,
      generateCode: () => collidingCode,
    });
    await assert.rejects(service.request('acct_customer'), /SHOWCASE_ACCESS_CODE_EXHAUSTED/);
    const rows = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM showcase_access_requests WHERE account_id = 'acct_customer'`,
    );
    assert.equal(rows.rows[0]?.total, 0, 'no row may be created when every one of the 5 attempts collides');
  });
});

test('a code generator that collides a few times then frees up still creates exactly one request', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const collidingCode = 'ABCDEFGH';
    const freshCode = 'ZYXWVTSR';
    await pool.query(
      `INSERT INTO showcase_access_requests (id, account_id, code) VALUES ($1, 'acct_other', $2)`,
      [randomUUID(), collidingCode],
    );
    let attempts = 0;
    const service = new ShowcaseAccessRequestService(pool, {
      accountDeletionHmacSecret: secret,
      generateCode: () => {
        attempts += 1;
        return attempts < 3 ? collidingCode : freshCode;
      },
    });
    const { created, request } = await service.request('acct_customer');
    assert.equal(created, true);
    assert.equal(request.code, freshCode);
    assert.ok(attempts >= 3, 'the retry loop must actually have collided before succeeding');
  });
});

test('a non-UUID request id is refused as not-found instead of a raw database error', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await assert.rejects(service.decide('acct_admin', 'not-a-uuid', 'APPROVED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
    await assert.rejects(service.decide('acct_admin', 'not-a-uuid', 'REJECTED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
  });
});

test('an access-request row claiming to be decided but missing decided_via is rejected by the database', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await assert.rejects(
      pool.query(
        `INSERT INTO showcase_access_requests (id, account_id, code, status, decided_at)
         VALUES ($1, 'acct_bad', 'ABCDEFGH', 'APPROVED', now())`,
        [randomUUID()],
      ),
      /violates check constraint/,
    );
  });
});

test('account deletion deletes the pending request outright, so neither APP approval nor the OPS command can act on it afterward', async () => {
  await withFreshShowcaseDatabase(async (pool, url) => {
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_leaving');
    const requestId = await requestIdFor(pool, request.code);

    const deletions = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-policy' });
    await deletions.requestDeletion({ accountId: 'acct_leaving', confirmation: 'DELETE MY ACCOUNT' });

    const remaining = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM showcase_access_requests WHERE id = $1`, [requestId],
    );
    assert.equal(remaining.rows[0]?.total, 0, 'a pending request must be deleted, not aliased, on account deletion');

    await assert.rejects(service.decide('acct_admin', requestId, 'APPROVED'), (error: unknown) =>
      error instanceof ShowcaseAccessRequestError && error.code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND');

    const command = fileURLToPath(new URL('./grant-approver-command.ts', import.meta.url));
    assert.throws(() =>
      execFileSync(process.execPath, ['--import', 'tsx', command, request.code], {
        env: { ...process.env, DATABASE_URL: url.toString(), ACCOUNT_DELETION_HMAC_SECRET: secret },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );

    const member = await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND (account_id = 'acct_leaving' OR account_id LIKE 'deleted:%')`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(member.rowCount, 0, 'neither the APP nor the OPS path may grant STAFF once the account is deleted');
    const admins = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM platform_admins WHERE account_id <> 'acct_admin'`,
    );
    assert.equal(admins.rows[0]?.total, 0, 'the OPS command must not grant the approver role to a deleted account');
  });
});

test('approving a request concurrently with that account being deleted never deadlocks and ends in one consistent outcome', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const deletions = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-policy' });

    const { request } = await service.request('acct_contested');
    const requestId = await requestIdFor(pool, request.code);

    const [decideResult, deletionResult] = await raceOnRequestRow(
      pool,
      requestId,
      () => service.decide('acct_admin', requestId, 'APPROVED'),
      () => deletions.requestDeletion({ accountId: 'acct_contested', confirmation: 'DELETE MY ACCOUNT' }),
    );

    for (const result of [decideResult, deletionResult]) {
      if (result.status === 'rejected') {
        assert.notEqual((result.reason as { code?: string } | undefined)?.code, '40P01', 'no deadlock error allowed');
      }
    }
    assert.equal(deletionResult.status, 'fulfilled', 'account deletion itself must always complete');

    // Deletion always runs to completion (it either goes first, or runs right after approval and then revokes
    // the membership approval just granted) — so the live account id must never end up with STAFF, whichever
    // side won the lock race.
    const member = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_contested'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(member.rows[0]?.total, 0, 'the deleted account must never end up with a live STAFF grant');

    const decided = await pool.query<{ status: string; account_id: string }>(
      `SELECT status, account_id FROM showcase_access_requests WHERE id = $1`, [requestId],
    );

    if (decideResult.status === 'fulfilled') {
      // Approval won the race and completed before deletion reached this account; deletion then aliased the
      // now-decided row instead of deleting it (it is no longer PENDING).
      assert.equal(decided.rows[0]?.status, 'APPROVED');
      assert.notEqual(decided.rows[0]?.account_id, 'acct_contested');
    } else {
      const reason = decideResult.reason;
      assert.ok(
        reason instanceof ShowcaseAccessRequestError &&
          (reason.code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND' || reason.code === 'ACCOUNT_DELETED'),
        `unexpected decide() failure: ${String(reason)}`,
      );
      assert.equal(decided.rowCount, 0, 'deletion must remove the pending row rather than leave it half-decided');
    }
  });
});

test('approving a request concurrently with that same account re-requesting never deadlocks', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_racer');
    const requestId = await requestIdFor(pool, request.code);

    const [decideResult, requestResult] = await raceOnRequestRow(
      pool,
      requestId,
      () => service.decide('acct_admin', requestId, 'APPROVED'),
      () => service.request('acct_racer'),
    );

    for (const result of [decideResult, requestResult]) {
      if (result.status === 'rejected') {
        assert.notEqual((result.reason as { code?: string } | undefined)?.code, '40P01', 'no deadlock error allowed');
      }
    }
    // Both lock the same account first, in the same order, so one simply waits for the other instead of deadlocking.
    // Approval must always eventually go through. The re-request either wins the race and returns the still-pending
    // row (created: false), or loses it and correctly finds the account already staffed.
    assert.equal(decideResult.status, 'fulfilled', 'the concurrent re-request must never block approval from completing');
    if (requestResult.status === 'rejected') {
      assert.ok(
        requestResult.reason instanceof ShowcaseAccessRequestError &&
          requestResult.reason.code === 'SHOWCASE_ACCESS_ALREADY_GRANTED',
        `unexpected request() failure: ${String(requestResult.reason)}`,
      );
    }

    const member = await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_racer'`, [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.ok(member.rowCount, 'the approval must still have granted STAFF');
  });
});

test('two approvers deciding each other\'s pending requests at the same moment never deadlocks (#304 P2)', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_mutual_a'), ('acct_mutual_b')`);
    const { request: requestA } = await service.request('acct_mutual_a');
    const { request: requestB } = await service.request('acct_mutual_b');
    const requestAId = await requestIdFor(pool, requestA.code);
    const requestBId = await requestIdFor(pool, requestB.code);

    // Each holder pins one account's advisory lock first, forcing both real decide() calls to queue on *both*
    // accounts deterministically instead of racing on timing. Before the fix, decide() locked its own approver
    // account alone before the sorted pair lock; releasing the holders in this order let each transaction end up
    // holding the account the other needs while waiting on the one it holds — the textbook two-cycle deadlock.
    const holderA = await holdAccountLock(pool, accountLifecycle, 'acct_mutual_a');
    const holderB = await holdAccountLock(pool, accountLifecycle, 'acct_mutual_b');
    const aDecidesB = service.decide('acct_mutual_a', requestBId, 'APPROVED');
    const bDecidesA = service.decide('acct_mutual_b', requestAId, 'APPROVED');
    await waitForBlockedBackends(pool, 2);
    await holderA.release();
    await holderB.release();
    const [aResult, bResult] = await Promise.allSettled([aDecidesB, bDecidesA]);

    for (const result of [aResult, bResult]) {
      if (result.status === 'rejected') {
        assert.notEqual((result.reason as { code?: string } | undefined)?.code, '40P01', 'no deadlock error allowed');
      }
    }
    assert.equal(aResult.status, 'fulfilled', "A deciding B's request must complete");
    assert.equal(bResult.status, 'fulfilled', "B deciding A's request must complete");

    const members = await pool.query<{ account_id: string }>(
      `SELECT account_id FROM merchant_members
       WHERE merchant_id = $1 AND account_id IN ('acct_mutual_a', 'acct_mutual_b') AND role = 'STAFF' AND status = 'ACTIVE'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(members.rowCount, 2, 'both mutual approvals must have granted STAFF');
  });
});

test('the OPS grant-approver command run concurrently with the same account re-requesting never deadlocks (#304 P2)', async () => {
  await withFreshLocalShowcaseDatabase(async (pool, url) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const { request } = await service.request('acct_ops_vs_request');
    const requestId = await requestIdFor(pool, request.code);

    const [opsResult, requestResult] = await raceOnRequestRow(
      pool,
      requestId,
      () => runGrantApproverCommand(url, request.code),
      () => service.request('acct_ops_vs_request'),
    );

    for (const result of [opsResult, requestResult]) {
      if (result.status === 'rejected') {
        assert.notEqual((result.reason as { code?: string } | undefined)?.code, '40P01', 'no deadlock error allowed');
      }
    }
    assert.equal(opsResult.status, 'fulfilled', 'the OPS command must always complete');
    assert.equal((opsResult as PromiseFulfilledResult<string>).value, 'SHOWCASE_APPROVER_GRANTED');
    if (requestResult.status === 'rejected') {
      assert.ok(
        requestResult.reason instanceof ShowcaseAccessRequestError &&
          requestResult.reason.code === 'SHOWCASE_ACCESS_ALREADY_GRANTED',
        `unexpected request() failure: ${String(requestResult.reason)}`,
      );
    }

    const member = await pool.query(
      `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_ops_vs_request'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.deepEqual(member.rows[0], { role: 'STAFF', status: 'ACTIVE' });
  });
});

test('the OPS grant-approver command run concurrently with that same account being deleted never deadlocks (#304 P2)', async () => {
  await withFreshLocalShowcaseDatabase(async (pool, url) => {
    const service = new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret: secret });
    const deletions = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-policy' });
    const { request } = await service.request('acct_ops_vs_deletion');
    const requestId = await requestIdFor(pool, request.code);

    const [opsResult, deletionResult] = await raceOnRequestRow(
      pool,
      requestId,
      () => runGrantApproverCommand(url, request.code),
      () => deletions.requestDeletion({ accountId: 'acct_ops_vs_deletion', confirmation: 'DELETE MY ACCOUNT' }),
    );

    for (const result of [opsResult, deletionResult]) {
      if (result.status === 'rejected') {
        assert.notEqual((result.reason as { code?: string } | undefined)?.code, '40P01', 'no deadlock error allowed');
      }
    }
    assert.equal(deletionResult.status, 'fulfilled', 'account deletion itself must always complete');
    // 이 스케줄에서는 OPS가 먼저 줄을 선다. 계정 → 행 순서라면 OPS가 먼저 끝나 관리자 등록에 성공해야 한다.
    // (옛 행 → 계정 순서에서는 OPS가 교착 피해자가 되어 종료 코드 1로 끝나는데, 그것도 위 검사를 통과하므로 따로 확인한다.)
    assert.equal(opsResult.status, 'fulfilled', `OPS command must succeed when it queues first: ${opsResult.status === 'rejected' ? String(opsResult.reason) : ''}`);
    assert.equal(opsResult.status === 'fulfilled' ? opsResult.value : '', 'SHOWCASE_APPROVER_GRANTED');

    // Whichever side won the lock race, the deleted account must never end up with a live STAFF grant: either
    // deletion went first and removed the pending row outright (OPS then finds nothing to decide), or OPS
    // approved first and deletion ran right after, revoking the membership it just granted.
    const member = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_ops_vs_deletion'`,
      [SHOWCASE_PRACTICE_MERCHANT_ID],
    );
    assert.equal(member.rows[0]?.total, 0, 'the deleted account must never end up with a live STAFF grant');
  });
});
