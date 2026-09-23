import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import {
  assertLocalShowcaseDatabaseUrl,
  assertShowcaseDatabaseTarget,
  seedLocalShowcase,
} from './local-seed.js';

export async function seedConfiguredLocalShowcase(
  databaseUrl: string | undefined,
  openPool: (url: string) => Pool = (url) => new Pool({ connectionString: url }),
  migrate: (pool: Pool) => Promise<void> = runMigrations,
): Promise<{ merchantId: string; campaignId: string }> {
  const checkedUrl = assertLocalShowcaseDatabaseUrl(databaseUrl ?? '');
  const pool = openPool(checkedUrl);
  try {
    await assertShowcaseDatabaseTarget(pool, 'masscom_showcase_test');
    await migrate(pool);
    return await seedLocalShowcase(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await seedConfiguredLocalShowcase(process.env.SHOWCASE_TEST_DATABASE_URL);
    console.log('LOCAL_SHOWCASE_SEEDED', result.merchantId, result.campaignId);
  } catch {
    console.error('SHOWCASE_LOCAL_SEED_FAILED');
    process.exitCode = 1;
  }
}
