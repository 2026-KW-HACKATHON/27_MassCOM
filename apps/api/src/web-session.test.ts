import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { PostgresWebSessionStore } from './postgres/web-session.js';

test('web session lookup does not disguise a database outage as an invalid user cookie', async () => {
  const token = randomBytes(32).toString('base64url');
  const client = {
    async query(sql: string) {
      if (sql.includes('FROM web_sessions')) return { rows: [{ account_id: 'account-a' }] };
      throw new Error('DB_UNAVAILABLE');
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const store = new PostgresWebSessionStore(pool, {
    hmacSecret: 'web-session-disposable-lifecycle-key-at-least-32-bytes',
    ttlMs: 60_000,
  });
  await assert.rejects(store.resolve(token), /DB_UNAVAILABLE/);
});
