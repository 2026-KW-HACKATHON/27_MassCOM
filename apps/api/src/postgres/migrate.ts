import { readdir, readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

const migrationsDirectory = new URL('../../migrations/', import.meta.url);
const migrationLockId = 2_026_091_801;

export function isMigrationFilename(filename: string): boolean {
  return /^\d{4}_[a-z0-9_]+\.sql$/.test(filename);
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock($1::bigint)', [migrationLockId]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await readdir(migrationsDirectory))
      .filter(isMigrationFilename)
      .sort();

    for (const filename of filenames) {
      const alreadyApplied = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE filename = $1) AS exists',
        [filename],
      );
      if (alreadyApplied.rows[0]?.exists) continue;

      const sql = await readFile(new URL(filename, migrationsDirectory), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1::bigint)', [migrationLockId]);
      } catch (error) {
        client.release(error as Error);
        throw error;
      }
    }
    client.release();
  }
}
