import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAdminService } from './postgres/admin.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const hmacSecret = 'admin-test-account-deletion-hmac-secret-32-bytes';

test('only a granted active Google account can create, edit, and hide a real merchant', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const service = new PostgresAdminService(pool, hmacSecret);
  const name = `관리 상점 ${randomUUID()}`;
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await assert.rejects(service.listMerchants(accountId), /ADMIN_FORBIDDEN/);
    await assert.rejects(service.grant('unknown-subject'), /ADMIN_IDENTITY_NOT_FOUND/);
    await service.grant(subject);
    assert.deepEqual(await service.listMerchants(accountId).then(rows => rows.filter(row => row.name === name)), []);

    const created = await service.createMerchant(accountId, {
      name, story: '실제 상점', roadAddress: '서울시', minimumSpendWon: 1000,
    });
    assert.equal(created.status, 'PAUSED');
    assert.equal(created.demo, false);
    assert.equal(created.version, 1);
    const updated = await service.updateMerchant(accountId, created.id, 1, {
      name: '수정 상점', story: '수정 소개', roadAddress: '서울시 새 주소', minimumSpendWon: 2000,
    });
    assert.equal(updated.version, 2);
    await assert.rejects(service.updateMerchant(accountId, created.id, 1, {
      name: '충돌', story: '', roadAddress: '서울시', minimumSpendWon: 0,
    }), /ADMIN_VERSION_CONFLICT/);
    await pool.query(`INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status,
      is_public, enrollment_capacity) VALUES ($1, $2, '방문', now() - interval '1 day',
      now() + interval '1 day', 'ACTIVE', true, 10)`, [randomUUID(), created.id]);
    const hidden = await service.hideMerchant(accountId, created.id, 2);
    assert.equal(hidden.status, 'PAUSED');
    assert.equal(hidden.version, 3);
    const campaigns = await pool.query('SELECT status, is_public FROM campaigns WHERE merchant_id = $1', [created.id]);
    assert.deepEqual(campaigns.rows, [{ status: 'PAUSED', is_public: false }]);
    const audit = await pool.query('SELECT action FROM platform_admin_audit WHERE merchant_id = $1 ORDER BY created_at', [created.id]);
    assert.deepEqual(audit.rows.map(row => row.action), ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN']);
    await service.revoke(subject);
    await assert.rejects(service.createMerchant(accountId, {
      name: '거부', story: '', roadAddress: '서울시', minimumSpendWon: 0,
    }), /ADMIN_FORBIDDEN/);
  } finally { await pool.end(); }
});

test('concurrent edits accept one version and audit failure rolls back the merchant write', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await service.grant(subject);
    const created = await service.createMerchant(accountId, {
      name: `경합 ${randomUUID()}`, story: '', roadAddress: '서울', minimumSpendWon: 0,
    });
    const attempts = await Promise.allSettled(['첫 수정', '두 번째 수정'].map(name =>
      service.updateMerchant(accountId, created.id, 1, {
        name, story: '', roadAddress: '서울', minimumSpendWon: 0,
      })));
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(item => item.status === 'rejected' &&
      String(item.reason).includes('ADMIN_VERSION_CONFLICT')).length, 1);
    await pool.query(`CREATE FUNCTION admin_audit_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER admin_audit_fail_test BEFORE INSERT ON platform_admin_audit
      FOR EACH ROW EXECUTE FUNCTION admin_audit_fail_test()`);
    try {
      await assert.rejects(service.hideMerchant(accountId, created.id, 2), /forced audit failure/);
      const after = await pool.query('SELECT status, version FROM merchants WHERE id = $1', [created.id]);
      assert.deepEqual(after.rows, [{ status: 'PAUSED', version: 2 }]);
    } finally {
      await pool.query('DROP TRIGGER admin_audit_fail_test ON platform_admin_audit');
      await pool.query('DROP FUNCTION admin_audit_fail_test()');
    }
  } finally { await pool.end(); }
});

test('account deletion removes admin grant and pseudonymizes the audit actor', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await service.grant(subject);
    const created = await service.createMerchant(accountId, {
      name: `삭제 확인 ${randomUUID()}`, story: '', roadAddress: '서울', minimumSpendWon: 0,
    });
    const deletion = new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'admin-test-v1',
    });
    const result = await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(await service.isAdmin(accountId), false);
    const role = await pool.query('SELECT 1 FROM platform_admins WHERE account_id = $1', [accountId]);
    assert.equal(role.rowCount, 0);
    const actor = await pool.query('SELECT actor_account_id FROM platform_admin_audit WHERE merchant_id = $1', [created.id]);
    assert.match(actor.rows[0]?.actor_account_id, /^deleted:[0-9a-f]{64}$/);
    await assert.rejects(service.grant(subject), /ADMIN_IDENTITY_NOT_FOUND/);
  } finally { await pool.end(); }
});

test('concurrent deletion and admin write leave no active role or identifying audit actor', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await service.grant(subject);
    const deletion = new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'admin-test-v1',
    });
    const [write, removed] = await Promise.allSettled([
      service.createMerchant(accountId, {
        name: `삭제 경합 ${randomUUID()}`, story: '', roadAddress: '서울', minimumSpendWon: 0,
      }),
      deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' }),
    ]);
    assert.equal(removed.status, 'fulfilled');
    assert.equal(await service.isAdmin(accountId), false);
    assert.equal((await pool.query('SELECT 1 FROM platform_admins WHERE account_id = $1', [accountId])).rowCount, 0);
    if (write.status === 'fulfilled') {
      const audit = await pool.query('SELECT actor_account_id FROM platform_admin_audit WHERE merchant_id = $1', [write.value.id]);
      assert.match(audit.rows[0]?.actor_account_id, /^deleted:[0-9a-f]{64}$/);
    } else {
      assert.match(String(write.reason), /ADMIN_FORBIDDEN/);
    }
  } finally { await pool.end(); }
});

test('concurrent revoke and admin write serialize on the role row', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await service.grant(subject);
    const [write, revoked] = await Promise.allSettled([
      service.createMerchant(accountId, {
        name: `회수 경합 ${randomUUID()}`, story: '', roadAddress: '서울', minimumSpendWon: 0,
      }),
      service.revoke(subject),
    ]);
    assert.equal(revoked.status, 'fulfilled');
    assert.equal(await service.isAdmin(accountId), false);
    if (write.status === 'rejected') assert.match(String(write.reason), /ADMIN_FORBIDDEN/);
    await assert.rejects(service.createMerchant(accountId, {
      name: '회수 후 거부', story: '', roadAddress: '서울', minimumSpendWon: 0,
    }), /ADMIN_FORBIDDEN/);
  } finally { await pool.end(); }
});
