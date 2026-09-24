import { Pool } from 'pg';

import { assertHostedShowcaseDatabaseUrl, seedHostedShowcase } from './host-seed.js';

async function main() {
  const databaseUrl = assertHostedShowcaseDatabaseUrl(process.env.DATABASE_URL ?? '');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await seedHostedShowcase(pool);
    console.log('SHOWCASE_HOST_SEEDED');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error('SHOWCASE_HOST_SEED_FAILED');
  process.exitCode = 1;
});
