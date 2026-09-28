import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionIntakeService } from './postgres/account-deletion-intake.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { isMigrationFilename, runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();
const hmacSecret = 'disposable-intake-lifecycle-key-at-least-32-bytes';
const migrations = new URL('../migrations/', import.meta.url);

test('an existing 0019–0022 database accepts late 0018/0023 migrations and one duplicate-safe intake row', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const bootstrap = new Pool({ connectionString: testUrl });
  const schema = `deletion_upgrade_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: testUrl, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const oldFiles = (await readdir(migrations)).filter((file) =>
      isMigrationFilename(file) && Number(file.slice(0, 4)) <= 22 &&
      file !== '0018_account_deletion_intake.sql').sort();
    for (const file of oldFiles) {
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    }
    assert.ok(oldFiles.some((file) => file.startsWith('0022_')));
    assert.equal((await pool.query("SELECT to_regclass('account_deletion_intake_requests') AS table_name"))
      .rows[0]?.table_name, null);

    await runMigrations(pool);
    const applied = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations WHERE filename IN ('0018_account_deletion_intake.sql', '0023_web_deletion_return.sql') ORDER BY filename",
    );
    assert.deepEqual(applied.rows.map((row) => row.filename), [
      '0018_account_deletion_intake.sql', '0023_web_deletion_return.sql',
    ]);
    const accountId = `upgrade-${randomUUID()}`;
    await pool.query(
      `INSERT INTO auth_identities(provider, subject, account_id, created_at)
       VALUES ('google', $1, $2, now())`, [accountId, accountId],
    );
    const intake = new PostgresAccountDeletionIntakeService(pool, hmacSecret);
    assert.deepEqual(await intake.request(accountId), { status: 'REQUESTED' });
    assert.deepEqual(await intake.request(accountId), { status: 'REQUESTED' });
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM account_deletion_intake_requests'))
      .rows[0]?.total, 1);
    await pool.query(
      `INSERT INTO web_oauth_states(state_hash, code_verifier, nonce, expires_at, return_to)
       VALUES (decode(repeat('ab', 32), 'hex'), $1, $1, now() + interval '5 minutes', '/account-deletion')`,
      ['v'.repeat(43)],
    );
  } finally {
    await pool?.end();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap.end();
  }
});

test('web intake is duplicate-safe, changes no account state, and is removed by final deletion', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    const accountId = `intake-${randomUUID()}`;
    await pool.query(
      `INSERT INTO auth_identities (provider, subject, account_id, created_at)
       VALUES ('google', $1, $2, now())`,
      [`subject-${accountId}`, accountId],
    );
    const intake = new PostgresAccountDeletionIntakeService(pool, hmacSecret);
    const results = await Promise.all(Array.from({ length: 10 }, () => intake.request(accountId)));
    assert.deepEqual(results, Array.from({ length: 10 }, () => ({ status: 'REQUESTED' })));
    assert.equal((await pool.query(
      'SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [accountId],
    )).rowCount, 1);
    assert.equal((await pool.query('SELECT 1 FROM auth_identities WHERE account_id = $1', [accountId])).rowCount, 1);
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_requests WHERE account_reference_hash = $1',
      [new PostgresAccountLifecycle({ hmacSecret }).referenceHash(accountId)])).rowCount, 0);

    const deletion = new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1',
    });
    await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query(
      'SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [accountId],
    )).rowCount, 0);
    await assert.rejects(intake.request(accountId), /WEB_SESSION_INVALID/);

    const racingAccount = `intake-race-${randomUUID()}`;
    await pool.query(
      `INSERT INTO auth_identities (provider, subject, account_id, created_at)
       VALUES ('google', $1, $2, now())`,
      [`subject-${racingAccount}`, racingAccount],
    );
    const [intakeRace, deletionRace] = await Promise.allSettled([
      intake.request(racingAccount),
      deletion.requestDeletion({ accountId: racingAccount, confirmation: 'DELETE MY ACCOUNT' }),
    ]);
    assert.equal(deletionRace.status, 'fulfilled');
    if (intakeRace.status === 'rejected') assert.match(String(intakeRace.reason), /WEB_SESSION_INVALID/);
    assert.equal((await pool.query(
      'SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [racingAccount],
    )).rowCount, 0);
  } finally {
    await pool.end();
  }
});
