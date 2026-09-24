import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { Pool } from 'pg';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();
const migrations = new URL('../../migrations/', import.meta.url);

test('existing web sessions gain apex origin without changing their token hash', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const client = await pool.connect();
  const schema = `web_origin_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(await readFile(new URL('0014_web_sessions.sql', migrations), 'utf8'));
    const id = randomUUID();
    const hash = randomBytes(32);
    await client.query(
      `INSERT INTO web_sessions(id, account_id, token_hash, created_at, expires_at)
       VALUES ($1, 'legacy-apex', $2, now(), now() + interval '1 hour')`,
      [id, hash],
    );
    await client.query(await readFile(new URL('0016_web_session_origin.sql', migrations), 'utf8'));
    const result = await client.query<{ origin_host: string; token_hash: Buffer }>(
      'SELECT origin_host, token_hash FROM web_sessions WHERE id = $1', [id],
    );
    assert.equal(result.rows[0]?.origin_host, 'masscom.kr');
    assert.deepEqual(result.rows[0]?.token_hash, hash);
    await assert.rejects(client.query(
      "UPDATE web_sessions SET origin_host = 'other.masscom.kr' WHERE id = $1", [id],
    ), { code: '23514' });
  } finally {
    await client.query('SET search_path TO public').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    client.release();
    await pool.end();
  }
});
