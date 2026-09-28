import { Pool } from 'pg';

import { PostgresAdminService } from './admin.js';

async function main(): Promise<void> {
  const [action, subject, extra] = process.argv.slice(2);
  if ((action !== 'grant' && action !== 'revoke') || !subject || extra || !process.env.DATABASE_URL) {
    throw new Error('ADMIN_ROLE_USAGE: grant|revoke <verified-google-subject> with DATABASE_URL');
  }
  const secret = process.env.ACCOUNT_DELETION_HMAC_SECRET ?? '';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const database = (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name;
    if (!database || /showcase|demo/i.test(database)) throw new Error('ADMIN_ROLE_PRODUCTION_DATABASE_REQUIRED');
    const service = new PostgresAdminService(pool, secret);
    if (action === 'grant') await service.grant(subject);
    else await service.revoke(subject);
    console.log(action === 'grant' ? 'ADMIN_GRANTED' : 'ADMIN_REVOKED');
  } finally { await pool.end(); }
}

main().catch(() => {
  console.error('ADMIN_ROLE_FAILED');
  process.exitCode = 1;
});
