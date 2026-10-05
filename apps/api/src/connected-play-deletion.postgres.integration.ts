import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresRetentionService } from './postgres/retention.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();

test('rollback deletion ledger is repaired by retention for every 0042 account table', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const secret = 'connected-play-deletion-test-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const deletedAccount = `play-deleted-${randomUUID()}`;
  const liveAccount = `play-live-${randomUUID()}`;
  const ledgerId = randomUUID();
  const runIds = [randomUUID(), randomUUID()];
  const liveRunId = randomUUID();
  const now = new Date();
  const retention = new PostgresRetentionService(pool);
  try {
    await runMigrations(pool);
    for (const [accountId, ids] of [[deletedAccount, runIds], [liveAccount, [liveRunId]]] as const) {
      for (const runId of ids) {
        await pool.query(
          `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
           VALUES ($1, $2, 'stack', 1, $3, $3::timestamptz + interval '1 hour', 2)`,
          [runId, accountId, now],
        );
      }
      await pool.query(
        `INSERT INTO play_records (account_id, kind, best_score, plays, version2_best_score, version2_plays)
         VALUES ($1, 'stack', 10, 2, 500, 1)`,
        [accountId],
      );
      await pool.query(
        `INSERT INTO studios (account_id, studio, updated_at) VALUES ($1, '{}'::jsonb, $2)`,
        [accountId, now],
      );
    }

    // Simulate the previous API image: its deletion commits the ledger without touching 0042 tables.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO account_deletion_requests (
           id, account_reference_hash, deleted_account_alias, status, policy_version,
           cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts,
           requested_at, completed_at, updated_at
         ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
        [ledgerId, lifecycle.referenceHash(deletedAccount),
          `deleted:${lifecycle.referenceHash(deletedAccount).toString('hex')}`, now],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const count = async (table: 'play_runs' | 'play_records' | 'studios', accountId: string) =>
      Number((await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM ${table} WHERE account_id = $1`, [accountId],
      )).rows[0]!.count);
    assert.deepEqual(await Promise.all((['play_runs', 'play_records', 'studios'] as const).map(
      (table) => count(table, deletedAccount),
    )), [2, 1, 1], 'the old image left all new rows after deletion');

    const wrongSecret = await retention.run({ hmacSecret: 'different-connected-play-secret-at-least-32-bytes' });
    assert.equal(wrongSecret.counts.find(({ step }) => step === 'deleted_play_data')?.count, 0);
    const repaired = await retention.run({ hmacSecret: secret });
    assert.deepEqual(repaired.failed, []);
    assert.equal(repaired.counts.find(({ step }) => step === 'deleted_play_data')?.count, 4);
    for (const table of ['play_runs', 'play_records', 'studios'] as const) {
      assert.equal(await count(table, deletedAccount), 0, `${table} must lose deleted account rows`);
      assert.equal(await count(table, liveAccount), 1, `${table} must keep live account rows`);
    }
    assert.equal((await retention.run({ hmacSecret: secret })).counts.find(
      ({ step }) => step === 'deleted_play_data',
    )?.count, 0, 'repair is idempotent');
  } finally {
    for (const table of ['play_runs', 'play_records', 'studios'] as const) {
      await pool.query(`DELETE FROM ${table} WHERE account_id = ANY($1::text[])`, [[deletedAccount, liveAccount]]).catch(() => {});
    }
    await pool.query('DELETE FROM account_deletion_requests WHERE id = $1', [ledgerId]).catch(() => {});
    await pool.end();
  }
});
