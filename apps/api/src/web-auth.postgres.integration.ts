import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from './postgres/migrate.js';
import { PostgresWebSessionStore } from './postgres/web-session.js';
import { WebAuthService } from './web-auth.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try { return decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test'); }
  catch { return false; }
})();

test('OIDC callback consumes browser-bound state once and creates only a web session for an existing account', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    const subject = `web-auth-${randomUUID()}`;
    const accountId = `acct_${randomUUID()}`;
    await pool.query(
      `INSERT INTO auth_identities(provider, subject, account_id, created_at)
       VALUES ('google', $1, $2, now())`, [subject, accountId],
    );
    let verifiedNonce = '';
    const service = new WebAuthService(pool, new PostgresWebSessionStore(pool, {
      hmacSecret: 'web-auth-disposable-hmac-secret-at-least-32-bytes', ttlMs: 60_000,
    }), {
      clientId: '1234567890-web.apps.googleusercontent.com',
      webCredential: 'test-only-secret',
      redirectUri: 'https://masscom.kr/api/web/auth/callback',
      exchangeCode: async (code, verifier) => {
        assert.equal(code, 'one-time-code');
        assert.equal(verifier.length, 43);
        return 'signed-id-token';
      },
      verifyIdToken: async () => ({ subject, nonce: verifiedNonce }),
    });
    const staleHash = createHash('sha256').update(`stale-${randomUUID()}`).digest();
    await pool.query(
      `INSERT INTO web_oauth_states(state_hash, code_verifier, nonce, expires_at)
       VALUES ($1, $2, $3, now() - interval '1 minute')`,
      [staleHash, 'a'.repeat(43), 'b'.repeat(43)],
    );
    const started = await service.start();
    assert.equal((await pool.query(
      'SELECT count(*)::int AS total FROM web_oauth_states WHERE state_hash = $1', [staleHash],
    )).rows[0]?.total, 0);
    const authorization = new URL(started.location);
    assert.equal(authorization.origin, 'https://accounts.google.com');
    assert.equal(authorization.searchParams.get('response_type'), 'code');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('redirect_uri'), 'https://masscom.kr/api/web/auth/callback');
    verifiedNonce = authorization.searchParams.get('nonce')!;
    assert.equal(authorization.searchParams.get('state'), started.state);
    assert.equal(authorization.searchParams.get('scope'), 'openid');

    await assert.rejects(service.complete('one-time-code', started.state, 'another-browser'), /WEB_AUTH_STATE_INVALID/);
    const session = await service.complete('one-time-code', started.state, started.state);
    assert.equal(await service.resolveSession(session.token), accountId);
    await assert.rejects(service.complete('one-time-code', started.state, started.state), /WEB_AUTH_STATE_INVALID/);
    const stored = await pool.query<{ token_hash: Buffer }>(
      'SELECT token_hash FROM web_sessions WHERE account_id = $1', [accountId],
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0]?.token_hash.toString('hex'), createHash('sha256').update(session.token).digest('hex'));
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM auth_sessions WHERE account_id = $1', [accountId])).rows[0]?.total, 0);
  } finally { await pool.end(); }
});

test('OIDC callback rejects a mismatched nonce and an unknown Google identity without creating a web session', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    const subject = `unknown-web-auth-${randomUUID()}`;
    const before = Number((await pool.query('SELECT count(*)::int AS total FROM web_sessions')).rows[0]?.total);
    let nonce = 'wrong-nonce';
    const service = new WebAuthService(pool, new PostgresWebSessionStore(pool, {
      hmacSecret: 'web-auth-disposable-hmac-secret-at-least-32-bytes', ttlMs: 60_000,
    }), {
      clientId: '1234567890-web.apps.googleusercontent.com',
      webCredential: 'test-only-secret',
      redirectUri: 'https://masscom.kr/api/web/auth/callback',
      exchangeCode: async () => 'signed-id-token',
      verifyIdToken: async () => ({ subject, nonce }),
    });
    const first = await service.start();
    await assert.rejects(service.complete('code', first.state, first.state), /WEB_AUTH_NONCE_INVALID/);
    const second = await service.start();
    nonce = new URL(second.location).searchParams.get('nonce')!;
    await assert.rejects(service.complete('code', second.state, second.state), /WEB_AUTH_ACCOUNT_NOT_FOUND/);
    assert.equal((await pool.query('SELECT count(*)::int AS total FROM web_sessions')).rows[0]?.total, before);
  } finally { await pool.end(); }
});
