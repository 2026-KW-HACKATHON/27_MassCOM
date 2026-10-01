import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import { PostgresAccountDeletionService } from '../postgres/account-deletion.js';
import { seedLocalShowcase, SHOWCASE_MERCHANT_ID } from './local-seed.js';
import { ShowcaseAccessRequestError, ShowcaseAccessRequestService } from './access-requests.js';

const secret = 'test-only-access-request-secret-at-least-32-bytes-long';

/** A fresh masscom_showcase_ci_<uuid>_test database, migrated and seeded with the three local demo merchants (store A included). */
async function withFreshShowcaseDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
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
      await run(pool);
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

test('approval grants STAFF on demo store A only and records the decision', async () => {
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
      [SHOWCASE_MERCHANT_ID],
    );
    assert.deepEqual(member.rows[0], { role: 'STAFF', status: 'ACTIVE' });
    const otherMembership = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM merchant_members WHERE account_id = 'acct_customer' AND merchant_id <> $1`,
      [SHOWCASE_MERCHANT_ID],
    );
    assert.equal(otherMembership.rows[0]?.total, 0, 'approval must not touch any other demo store');

    const decided = await pool.query(
      `SELECT status, decided_via, decided_by_account_id FROM showcase_access_requests WHERE account_id = 'acct_customer'`,
    );
    assert.equal(decided.rows[0]?.status, 'APPROVED');
    assert.equal(decided.rows[0]?.decided_via, 'APP');
    assert.equal(decided.rows[0]?.decided_by_account_id, 'acct_admin');

    const mine = await service.mine('acct_customer');
    assert.equal(mine.staff, true);
    assert.equal(mine.request?.status, 'APPROVED');
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
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'acct_customer'`, [SHOWCASE_MERCHANT_ID],
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

// grant-approver-command.ts is gated by assertLocalShowcaseDatabaseUrl, which (unlike the service's own DB-name
// check) accepts only the exact literal local database name — so this test, unlike the others above, owns that
// one fixed database name for its duration instead of a per-run masscom_showcase_ci_*_test name.
test('ops command grants the approver role, audits it with the DB session user, and approves via OPS', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const localUrl = new URL(connectionString);
  localUrl.pathname = '/masscom_showcase_test';
  localUrl.search = '';
  localUrl.hash = '';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(localUrl.hostname)) {
    throw new Error('TEST_DATABASE_URL host is not eligible for the fixed local showcase database name');
  }
  const admin = new Pool({ connectionString });
  let pool: Pool | undefined;
  try {
    await admin.query('DROP DATABASE IF EXISTS "masscom_showcase_test"');
    await admin.query('CREATE DATABASE "masscom_showcase_test"');
    pool = new Pool({ connectionString: localUrl.toString() });
    await runMigrations(pool);
    await seedLocalShowcase(pool);
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
      [SHOWCASE_MERCHANT_ID],
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
  } finally {
    try {
      await pool?.end();
    } finally {
      await admin.query('DROP DATABASE IF EXISTS "masscom_showcase_test"').catch(() => {});
      await admin.end();
    }
  }
});
