import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { runMigrations } from '../src/postgres/migrate.js';
import { PostgresWebSessionStore } from '../src/postgres/web-session.js';
import { WebAuthService } from '../src/web-auth.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test')) {
  throw new Error('rollback fixture requires a disposable _test database');
}

const pool = new Pool({ connectionString: databaseUrl });
await runMigrations(pool);
const accountId = `pending-www-${randomUUID()}`;
const subject = `subject-${accountId}`;
await pool.query(
  `INSERT INTO auth_identities(provider, subject, account_id, created_at)
   VALUES ('google', $1, $2, now())`, [subject, accountId],
);
const service = new WebAuthService(pool, new PostgresWebSessionStore(pool, {
  hmacSecret: 'rollback-fixture-hmac-secret-at-least-32-bytes', ttlMs: 60_000,
}), {
  clientId: '1234567890-web.apps.googleusercontent.com',
  webCredential: 'test-only-secret',
  redirectUri: 'https://masscom.kr/api/web/auth/callback',
  wwwEnabled: true,
  exchangeCode: async () => {
    process.stdout.write('WAITING_FOR_GOOGLE\n');
    setInterval(() => {}, 1_000);
    return new Promise<string>(() => {});
  },
  verifyIdToken: async () => ({ subject, nonce: '' }),
});
const started = await service.start('https://www.masscom.kr');
await service.complete('held-code', started.state, started.state, 'https://www.masscom.kr');
