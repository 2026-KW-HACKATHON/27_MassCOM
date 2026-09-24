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

function startCallback(accountId) {
  const child = spawn(process.execPath, ['--import', 'tsx',
    resolve(repoRoot, 'apps/api/test-fixtures/pending-www-callback.ts'),
  ], {
    cwd: resolve(repoRoot, 'apps/api'),
    env: { ...process.env, TEST_DATABASE_URL: testUrl, ROLLBACK_TEST_ACCOUNT_ID: accountId },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
  const waitFor = (marker) => new Promise((resolveReady, reject) => {
    if (output.includes(marker)) return resolveReady();
    const timer = setTimeout(() => { cleanup(); reject(new Error(`callback timed out waiting for ${marker}: ${errors}`)); }, 10_000);
    const onData = () => {
      if (!output.includes(marker)) return;
      cleanup();
      resolveReady();
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`callback exited before ${marker} (${code ?? signal}): ${errors}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.once('exit', onExit);
  });
  return { child, waitFor };
}

async function activeSessions(pool, accountId) {
  const result = await pool.query(
    `SELECT count(*)::int AS active FROM web_sessions
     WHERE account_id = $1 AND origin_host = 'www.masscom.kr'
       AND revoked_at IS NULL AND expires_at > now()`, [accountId],
  );
  return result.rows[0]?.active;
}

test('rollback stops pending www callbacks before session revocation', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const unsafeId = `rollback-unsafe-${randomUUID()}`;
  const safeId = `rollback-safe-${randomUUID()}`;
  const unsafe = startCallback(unsafeId);
  let safe;
  try {
    await unsafe.waitFor('WAITING_FOR_GOOGLE');
    // Counterexample: revoking before the delayed callback finishes permits a fresh session.
    await pool.query(
      `UPDATE web_sessions SET revoked_at = now()
       WHERE origin_host = 'www.masscom.kr' AND revoked_at IS NULL AND expires_at > now()`,
    );
    unsafe.child.stdin.write('RELEASE\n');
    await unsafe.waitFor('SESSION_CREATED');
    assert.equal(await activeSessions(pool, unsafeId), 1);

    safe = startCallback(safeId);
    await safe.waitFor('WAITING_FOR_GOOGLE');
    const apexId = randomUUID();
    await pool.query(
      `INSERT INTO web_sessions(id, account_id, token_hash, created_at, expires_at, origin_host)
       VALUES ($1, 'rollback-apex', $2, now(), now() + interval '1 hour', 'masscom.kr')`,
      [apexId, randomBytes(32)],
    );

    // Production order: block www upstream, stop old API process, then revoke www sessions.
    const exited = once(safe.child, 'exit');
    assert.equal(safe.child.kill('SIGTERM'), true);
    const [, signal] = await exited;
    assert.equal(signal, 'SIGTERM');
    await pool.query(
      `UPDATE web_sessions SET revoked_at = now()
       WHERE origin_host = 'www.masscom.kr' AND revoked_at IS NULL AND expires_at > now()`,
    );
    assert.equal(await activeSessions(pool, unsafeId), 0);
    assert.equal(await activeSessions(pool, safeId), 0);
    const apex = await pool.query('SELECT revoked_at FROM web_sessions WHERE id = $1', [apexId]);
    assert.equal(apex.rows[0]?.revoked_at, null);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(await activeSessions(pool, safeId), 0);
  } finally {
    if (unsafe.child.exitCode === null && unsafe.child.signalCode === null) unsafe.child.kill('SIGKILL');
    if (safe?.child.exitCode === null && safe?.child.signalCode === null) safe.child.kill('SIGKILL');
    await pool.end();
  }
});
