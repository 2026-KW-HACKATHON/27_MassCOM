import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionIntakeService } from './postgres/account-deletion-intake.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();
const hmacSecret = 'disposable-intake-lifecycle-key-at-least-32-bytes';

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
