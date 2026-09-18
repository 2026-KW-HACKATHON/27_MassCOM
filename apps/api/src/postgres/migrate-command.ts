import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { runMigrations } from './migrate.js';

export async function migrateConfiguredDatabase(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  if (!databaseUrl?.trim()) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrateConfiguredDatabase();
  console.log('database migrations applied');
}
