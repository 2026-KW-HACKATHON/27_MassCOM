import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresStaffRegistration } from './postgres/staff-registration.js';
import { runMigrations } from './postgres/migrate.js';

const url = process.env.TEST_DATABASE_URL;
const enabled = url && decodeURIComponent(new URL(url).pathname.slice(1)).endsWith('_test');
const secret = 'staff-registration-test-hmac-secret-32-bytes';

test('registration code is account and merchant bound, single use, and its audit is atomic', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const staff = new PostgresStaffRegistration(pool, secret);
  const adminId = `admin-${randomUUID()}`;
  const accountId = `staff-${randomUUID()}`;
  const merchantId = randomUUID();
  const otherMerchantId = randomUUID();
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now()), ('google', $3, $4, now())`,
      [`admin-sub-${randomUUID()}`, adminId, `staff-sub-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE'), ($2, '다른 상점', '', '서울', 0, 'ACTIVE')`,
      [merchantId, otherMerchantId]);
    const issued = await staff.request(accountId, merchantId);
    assert.equal(issued.code.length, 22);
    const stored = await pool.query('SELECT code_hash FROM staff_registration_requests WHERE id = $1', [issued.requestId]);
    assert.deepEqual(stored.rows[0].code_hash, createHash('sha256').update(issued.code).digest());
    await assert.rejects(staff.approve(adminId, otherMerchantId, issued.code), { code: 'STAFF_CODE_INVALID' });
    assert.equal((await pool.query('SELECT 1 FROM merchant_members WHERE account_id = $1', [accountId])).rowCount, 0);
    await pool.query(`CREATE FUNCTION staff_audit_fail_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced staff audit failure'; END $$`);
    await pool.query(`CREATE TRIGGER staff_audit_fail_test BEFORE INSERT ON staff_registration_audit
      FOR EACH ROW EXECUTE FUNCTION staff_audit_fail_test()`);
    try {
      await assert.rejects(staff.approve(adminId, merchantId, issued.code), /forced staff audit failure/);
      assert.equal((await pool.query('SELECT 1 FROM merchant_members WHERE account_id = $1', [accountId])).rowCount, 0);
    } finally {
      await pool.query('DROP TRIGGER staff_audit_fail_test ON staff_registration_audit');
      await pool.query('DROP FUNCTION staff_audit_fail_test()');
    }
    await staff.approve(adminId, merchantId, issued.code);
    await assert.rejects(staff.approve(adminId, merchantId, issued.code), { code: 'STAFF_CODE_INVALID' });
    assert.equal((await pool.query(`SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2`,
      [merchantId, accountId])).rows[0].role, 'STAFF');
    assert.deepEqual((await pool.query(`SELECT action FROM staff_registration_audit WHERE merchant_id = $1`,
      [merchantId])).rows.map(row => row.action), ['APPROVED']);
    const deletion = new PostgresAccountDeletionService(pool, {
      hmacSecret: secret, policyVersion: 'staff-registration-test',
    });
    await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query('SELECT 1 FROM staff_registration_requests WHERE account_id = $1', [accountId])).rowCount, 0);
    assert.match((await pool.query('SELECT target_account_id FROM staff_registration_audit WHERE merchant_id = $1',
      [merchantId])).rows[0].target_account_id, /^deleted:/);
  } finally { await pool.end(); }
});

test('expired and superseded codes fail; revoke preserves OWNER', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const staff = new PostgresStaffRegistration(pool, secret);
  const adminId = `admin-${randomUUID()}`;
  const accountId = `staff-${randomUUID()}`;
  const ownerId = `owner-${randomUUID()}`;
  const merchantId = randomUUID();
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now()), ('google', $3, $4, now())`,
      [`admin-sub-${randomUUID()}`, adminId, `staff-sub-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
      VALUES ($1, $2, 'OWNER', 'ACTIVE')`, [merchantId, ownerId]);
    const first = await staff.request(accountId, merchantId);
    const second = await staff.request(accountId, merchantId);
    await assert.rejects(staff.approve(adminId, merchantId, first.code), { code: 'STAFF_CODE_INVALID' });
    await pool.query(`UPDATE staff_registration_requests
      SET created_at = now() - interval '16 minutes', expires_at = now() - interval '1 second'
      WHERE id = $1`, [second.requestId]);
    await assert.rejects(staff.approve(adminId, merchantId, second.code), { code: 'STAFF_CODE_INVALID' });
    const third = await staff.request(accountId, merchantId);
    await staff.approve(adminId, merchantId, third.code);
    await assert.rejects(staff.revoke(adminId, merchantId, ownerId), { code: 'STAFF_NOT_FOUND' });
    await staff.revoke(adminId, merchantId, accountId);
    assert.equal((await pool.query(`SELECT status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2`,
      [merchantId, ownerId])).rows[0].status, 'ACTIVE');
    assert.equal((await pool.query(`SELECT status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2`,
      [merchantId, accountId])).rows[0].status, 'REVOKED');
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM staff_registration_audit
      WHERE merchant_id = $1 AND action = 'REVOKED'`, [merchantId])).rows[0].count, 1);
  } finally { await pool.end(); }
});

test('claim issue racing STAFF revoke leaves no usable membership after revoke', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const staff = new PostgresStaffRegistration(pool, secret);
  const claims = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'staff-claim-reference-hmac-secret-32-bytes',
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret: secret }),
  });
  const adminId = `admin-${randomUUID()}`;
  const accountId = `staff-${randomUUID()}`;
  const merchantId = randomUUID();
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now()), ('google', $3, $4, now())`,
      [`admin-sub-${randomUUID()}`, adminId, `staff-sub-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status,
      is_public, enrollment_capacity) VALUES ($1, $2, '방문', now() - interval '1 day',
      now() + interval '1 day', 'ACTIVE', true, 10)`, [randomUUID(), merchantId]);
    const issued = await staff.request(accountId, merchantId);
    await staff.approve(adminId, merchantId, issued.code);
    const [claim, revoke] = await Promise.allSettled([
      claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
        merchantReference: `order-${randomUUID()}`, createdByAccountId: accountId }),
      staff.revoke(adminId, merchantId, accountId),
    ]);
    assert.equal(revoke.status, 'fulfilled');
    if (claim.status === 'rejected') assert.equal(claim.reason.code, 'MERCHANT_ACCESS_DENIED');
    assert.equal((await pool.query(`SELECT status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2`,
      [merchantId, accountId])).rows[0].status, 'REVOKED');
    await assert.rejects(claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: accountId }),
    { code: 'MERCHANT_ACCESS_DENIED' });
  } finally { await pool.end(); }
});

test('STAFF approval and revoke serialize with claim issue and reissue using production lifecycle locks', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const staff = new PostgresStaffRegistration(pool, secret);
  const claims = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'staff-claim-reference-hmac-secret-32-bytes', accountLifecycle: lifecycle,
  });
  const adminId = `admin-${randomUUID()}`;
  const accountId = `staff-${randomUUID()}`;
  const merchantId = randomUUID();
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now()), ('google', $3, $4, now())`,
      [`admin-sub-${randomUUID()}`, adminId, `staff-sub-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status,
      is_public, enrollment_capacity) VALUES ($1, $2, '방문', now() - interval '1 day',
      now() + interval '1 day', 'ACTIVE', true, 10)`, [randomUUID(), merchantId]);
    const code = await staff.request(accountId, merchantId);
    const [approval, earlyIssue] = await Promise.allSettled([
      staff.approve(adminId, merchantId, code.code),
      claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
        merchantReference: `order-${randomUUID()}`, createdByAccountId: accountId }),
    ]);
    assert.equal(approval.status, 'fulfilled');
    if (earlyIssue.status === 'rejected') assert.equal(earlyIssue.reason.code, 'MERCHANT_ACCESS_DENIED');
    const slot = await claims.issue({ merchantId, customerAccountId: `customer-${randomUUID()}`,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: accountId });
    const [reissue, revoke] = await Promise.allSettled([
      claims.reissue({ merchantId, claimSlotId: slot.claimSlotId,
        expectedTokenVersion: slot.tokenVersion, requestedByAccountId: accountId }),
      staff.revoke(adminId, merchantId, accountId),
    ]);
    assert.equal(revoke.status, 'fulfilled');
    if (reissue.status === 'rejected') assert.equal(reissue.reason.code, 'MERCHANT_ACCESS_DENIED');
    await assert.rejects(claims.reissue({ merchantId, claimSlotId: slot.claimSlotId,
      expectedTokenVersion: reissue.status === 'fulfilled' ? reissue.value.tokenVersion : slot.tokenVersion,
      requestedByAccountId: accountId }), { code: 'MERCHANT_ACCESS_DENIED' });
  } finally { await pool.end(); }
});

test('opposite admin and target STAFF revokes complete without lifecycle deadlock', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const merchantId = randomUUID();
  const accounts = [`admin-${randomUUID()}`, `admin-${randomUUID()}`] as const;
  try {
    await runMigrations(pool);
    for (const accountId of accounts) {
      await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
        VALUES ('google', $1, $2, now())`, [`sub-${randomUUID()}`, accountId]);
      await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [accountId]);
    }
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    for (const accountId of accounts) {
      await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status)
        VALUES ($1, $2, 'STAFF', 'ACTIVE')`, [merchantId, accountId]);
    }
    let firstLocks = 0;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    const coordinatedPool = {
      connect: async () => {
        const client = await pool.connect();
        let firstLock = true;
        return {
          query: async (...args: Parameters<typeof client.query>) => {
            const result = await client.query(...args);
            if (firstLock && typeof args[0] === 'string' && args[0].startsWith('SELECT pg_advisory_xact_lock')) {
              firstLock = false;
              firstLocks += 1;
              if (firstLocks === 2) releaseGate();
              await Promise.race([gate, new Promise(resolve => setTimeout(resolve, 150))]);
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    } as unknown as Pool;
    const staff = new PostgresStaffRegistration(coordinatedPool, secret);
    const results = await Promise.allSettled([
      staff.revoke(accounts[0], merchantId, accounts[1]),
      staff.revoke(accounts[1], merchantId, accounts[0]),
    ]);
    assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
  } finally { await pool.end(); }
});

test('approval fails when code expires while waiting for the merchant lock', {
  skip: enabled ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: url });
  const staff = new PostgresStaffRegistration(pool, secret);
  const adminId = `admin-${randomUUID()}`;
  const accountId = `staff-${randomUUID()}`;
  const merchantId = randomUUID();
  const blocker = await pool.connect();
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now()), ('google', $3, $4, now())`,
      [`admin-sub-${randomUUID()}`, adminId, `staff-sub-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [adminId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status)
      VALUES ($1, '실제 상점', '', '서울', 0, 'ACTIVE')`, [merchantId]);
    const issued = await staff.request(accountId, merchantId);
    const expiresAt = (await pool.query<{ expires_at: Date }>(
      `UPDATE staff_registration_requests SET expires_at = clock_timestamp() + interval '2 seconds'
       WHERE id = $1 RETURNING expires_at`, [issued.requestId])).rows[0]!.expires_at;
    await blocker.query('BEGIN');
    const blockerPid = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    await blocker.query('SELECT 1 FROM merchants WHERE id = $1 FOR UPDATE', [merchantId]);
    const approval = staff.approve(adminId, merchantId, issued.code);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      waiting = (await pool.query<{ waiting: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE pid <> $1 AND $1 = ANY(pg_blocking_pids(pid))
      ) AS waiting`, [blockerPid])).rows[0]!.waiting;
      if (waiting) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 100)));
    await blocker.query('COMMIT');
    await assert.rejects(approval, { code: 'STAFF_CODE_INVALID' });
    assert.equal((await pool.query('SELECT 1 FROM merchant_members WHERE account_id = $1', [accountId])).rowCount, 0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pool.end();
  }
});
