import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '../..');
const requireApi = createRequire(resolve(repoRoot, 'apps/api/package.json'));
const { Pool } = requireApi('pg');
const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();

function waitingForGoogle(child) {
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('pending callback did not start')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('WAITING_FOR_GOOGLE')) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`callback exited before the stop gate (${code ?? signal})`));
    });
  });
}

test('stopping a delayed www callback before revocation leaves no late www session', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const child = spawn(process.execPath, ['--import', 'tsx',
    resolve(repoRoot, 'apps/api/test-fixtures/pending-www-callback.ts'),
  ], {
    cwd: resolve(repoRoot, 'apps/api'),
    env: { ...process.env, TEST_DATABASE_URL: testUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitingForGoogle(child);
    const exited = once(child, 'exit');
    assert.equal(child.kill('SIGTERM'), true);
    const [, signal] = await exited;
    assert.equal(signal, 'SIGTERM');

    const apexId = randomUUID();
    const wwwId = randomUUID();
    await pool.query(
      `INSERT INTO web_sessions(id, account_id, token_hash, created_at, expires_at, origin_host)
       VALUES ($1, 'rollback-apex', $2, now(), now() + interval '1 hour', 'masscom.kr'),
              ($3, 'rollback-www', $4, now(), now() + interval '1 hour', 'www.masscom.kr')`,
      [apexId, randomBytes(32), wwwId, randomBytes(32)],
    );
    await pool.query(
      `UPDATE web_sessions SET revoked_at = now()
       WHERE origin_host = 'www.masscom.kr' AND revoked_at IS NULL AND expires_at > now()`,
    );
    const after = await pool.query(
      `SELECT count(*)::int AS active FROM web_sessions
       WHERE origin_host = 'www.masscom.kr' AND revoked_at IS NULL AND expires_at > now()`,
    );
    assert.equal(after.rows[0]?.active, 0);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    const apex = await pool.query('SELECT revoked_at FROM web_sessions WHERE id = $1', [apexId]);
    const www = await pool.query('SELECT revoked_at FROM web_sessions WHERE id = $1', [wwwId]);
    assert.equal(apex.rows[0]?.revoked_at, null);
    assert.ok(www.rows[0]?.revoked_at instanceof Date);
    const settled = await pool.query(
      `SELECT count(*)::int AS active FROM web_sessions
       WHERE origin_host = 'www.masscom.kr' AND revoked_at IS NULL AND expires_at > now()`,
    );
    assert.equal(settled.rows[0]?.active, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await pool.end();
  }
});
