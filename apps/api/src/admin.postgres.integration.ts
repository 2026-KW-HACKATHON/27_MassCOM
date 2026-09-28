import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAdminService } from './postgres/admin.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const hmacSecret = 'admin-test-account-deletion-hmac-secret-32-bytes';

test('operator grant and revoke create role audit in the same transaction', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const admin = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await pool.query(`CREATE FUNCTION admin_role_audit_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced role audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER admin_role_audit_fail_test BEFORE INSERT ON platform_admin_role_audit
      FOR EACH ROW EXECUTE FUNCTION admin_role_audit_fail_test()`);
    try {
      await assert.rejects(admin.grant(subject), /forced role audit failure/);
      assert.equal((await pool.query('SELECT 1 FROM platform_admins WHERE account_id = $1', [accountId])).rowCount, 0);
    } finally {
      await pool.query('DROP TRIGGER admin_role_audit_fail_test ON platform_admin_role_audit');
      await pool.query('DROP FUNCTION admin_role_audit_fail_test()');
    }
    await admin.grant(subject);
    await pool.query(`CREATE FUNCTION admin_role_audit_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced role audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER admin_role_audit_fail_test BEFORE INSERT ON platform_admin_role_audit
      FOR EACH ROW WHEN (NEW.action = 'REVOKE') EXECUTE FUNCTION admin_role_audit_fail_test()`);
    try {
      await assert.rejects(admin.revoke(subject), /forced role audit failure/);
      assert.equal(await admin.isAdmin(accountId), true);
    } finally {
      await pool.query('DROP TRIGGER admin_role_audit_fail_test ON platform_admin_role_audit');
      await pool.query('DROP FUNCTION admin_role_audit_fail_test()');
    }
    await admin.revoke(subject);
    const audit = await pool.query(
      'SELECT action, db_user FROM platform_admin_role_audit WHERE target_account_id = $1 ORDER BY created_at, id',
      [accountId],
    );
    assert.deepEqual(audit.rows.map(row => row.action), ['GRANT', 'REVOKE']);
    assert.ok(audit.rows.every(row => typeof row.db_user === 'string' && row.db_user.length > 0));
  } finally { await pool.end(); }
});

test('pending QR blocks hide until redeemed, then hide pauses campaign and prevents new QR', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const merchantId = randomUUID();
  const campaignId = randomUUID();
  const staffId = `staff-${randomUUID()}`;
  const customerId = `customer-${randomUUID()}`;
  const admin = new PostgresAdminService(pool, hmacSecret);
  const claims = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'admin-test-claim-reference-secret-32-bytes',
  });
  const identity = new PostgresCustomerIdentityService(pool, {
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret }),
  });
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await admin.grant(subject);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
      VALUES ($1, $2, 'STAFF', 'ACTIVE')`, [merchantId, staffId]);
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status,
      is_public, enrollment_capacity) VALUES ($1, $2, '방문', now() - interval '1 day',
      now() + interval '1 day', 'ACTIVE', true, 10)`, [campaignId, merchantId]);
    await pool.query(`INSERT INTO campaign_goals(campaign_id, target_visit_count, display_name)
      VALUES ($1, 1, '첫 방문'), ($1, 3, '세 번째 방문'), ($1, 5, '다섯 번째 방문')`, [campaignId]);
    const identityToken = await identity.create(customerId);
    await identity.resolve({ token: identityToken.token, merchantId, staffAccountId: staffId });
    const issueInput = { merchantId, customerIdentityToken: identityToken.token,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: staffId };
    const slot = await claims.issue(issueInput);
    if (!('token' in slot)) throw new Error('first issue must contain a QR token');
    await assert.rejects(admin.hideMerchant(accountId, merchantId, 1), { code: 'ADMIN_PENDING_CLAIMS' });
    const before = await pool.query('SELECT status, is_public FROM campaigns WHERE id = $1', [campaignId]);
    assert.deepEqual(before.rows, [{ status: 'ACTIVE', is_public: true }]);
    assert.equal((await claims.preview({ accountId: customerId, token: slot.token })).status, 'AVAILABLE');
    assert.equal((await claims.redeem({ accountId: customerId, token: slot.token })).status, 'CLAIMED');
    const expired = await claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: staffId });
    await pool.query(`UPDATE claim_slots SET created_at = now() - interval '1 day',
      expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.claimSlotId]);
    const hidden = await admin.hideMerchant(accountId, merchantId, 1);
    assert.equal(hidden.status, 'PAUSED');
    assert.deepEqual(await claims.issue(issueInput), {
      claimSlotId: slot.claimSlotId, tokenVersion: slot.tokenVersion,
      expiresAt: slot.expiresAt, replayed: true,
    });
    await assert.rejects(claims.reissue({ merchantId, claimSlotId: expired.claimSlotId,
      expectedTokenVersion: expired.tokenVersion, requestedByAccountId: staffId }),
    { code: 'CLAIM_MERCHANT_INACTIVE' });
    assert.deepEqual((await pool.query('SELECT status, is_public FROM campaigns WHERE id = $1',
      [campaignId])).rows, [{ status: 'PAUSED', is_public: false }]);
    await assert.rejects(claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: staffId }),
    { code: 'CLAIM_MERCHANT_INACTIVE' });
  } finally { await pool.end(); }
});

test('concurrent QR issue and hide allow only a safe winner', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  const merchantId = randomUUID();
  const campaignId = randomUUID();
  const staffId = `staff-${randomUUID()}`;
  const admin = new PostgresAdminService(pool, hmacSecret);
  const claims = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'admin-test-claim-reference-secret-32-bytes',
  });
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [subject, accountId]);
    await admin.grant(subject);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '경합 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
      VALUES ($1, $2, 'STAFF', 'ACTIVE')`, [merchantId, staffId]);
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status,
      is_public, enrollment_capacity) VALUES ($1, $2, '방문', now() - interval '1 day',
      now() + interval '1 day', 'ACTIVE', true, 10)`, [campaignId, merchantId]);
    await pool.query(`INSERT INTO campaign_goals(campaign_id, target_visit_count, display_name)
      VALUES ($1, 1, '첫 방문'), ($1, 3, '세 번째 방문'), ($1, 5, '다섯 번째 방문')`, [campaignId]);
    const [issue, hide] = await Promise.allSettled([
      claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
        merchantReference: `order-${randomUUID()}`, createdByAccountId: staffId }),
      admin.hideMerchant(accountId, merchantId, 1),
    ]);
    assert.equal([issue, hide].filter(result => result.status === 'fulfilled').length, 1);
    if (issue.status === 'fulfilled') {
      assert.equal(hide.status, 'rejected');
      assert.equal(hide.reason.code, 'ADMIN_PENDING_CLAIMS');
      assert.equal((await pool.query('SELECT status FROM merchants WHERE id = $1', [merchantId])).rows[0]?.status, 'ACTIVE');
      assert.equal((await pool.query('SELECT status FROM campaigns WHERE id = $1', [campaignId])).rows[0]?.status, 'ACTIVE');
    } else {
      assert.equal(issue.reason.code, 'CLAIM_MERCHANT_INACTIVE');
      assert.equal(hide.status, 'fulfilled');
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM claim_slots WHERE merchant_id = $1',
        [merchantId])).rows[0]?.count, 0);
      assert.equal((await pool.query('SELECT status FROM campaigns WHERE id = $1', [campaignId])).rows[0]?.status, 'PAUSED');
    }
  } finally { await pool.end(); }
});

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
    const roleAudit = await pool.query('SELECT target_account_id FROM platform_admin_role_audit WHERE target_account_id LIKE $1',
      ['deleted:%']);
    assert.ok(roleAudit.rows.some(row => row.target_account_id === actor.rows[0]?.actor_account_id));
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
