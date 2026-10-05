import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { MerchantOperationError } from './merchant-operations.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantOperations } from './postgres/merchant-operations.js';
import { requireActiveMerchantMember } from './postgres/merchant-membership.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safe = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safe ? false : 'requires a disposable _merchant_test database';
const NOW = new Date('2026-10-07T03:00:00.000Z');
const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'merchant-operation-test-secret-32-bytes' });

test('owner renewal is scoped, consented, compare-and-swap, idempotent and audited', { skip }, async t => {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  await pool.query('TRUNCATE auth_identities CASCADE');
  await pool.query(`INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status)
    VALUES ('ops-a', '가게 A', '', '서울', 0, 'ACTIVE'), ('ops-b', '가게 B', '', '서울', 0, 'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES
    ('ops-a','owner-a','OWNER','ACTIVE'),('ops-a','staff-a','STAFF','ACTIVE'),
    ('ops-b','owner-b','OWNER','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
    VALUES ('ops-campaign','ops-a','=SUM(1,1)','2026-09-01T00:00:00Z','2026-10-31T00:00:00Z','ACTIVE',true,50)`);
  const service = new PostgresMerchantOperations(pool, { accountLifecycle: lifecycle, now: () => NOW });
  const input = { accountId: 'owner-a', merchantId: 'ops-a', campaignId: 'ops-campaign', days: 30 as const,
    expectedEndsAt: '2026-10-31T00:00:00.000Z', consentAccepted: true, requestId: randomUUID() };
  await assert.rejects(service.extendCampaign({ ...input, accountId: 'staff-a' }),
    (error: unknown) => error instanceof MerchantOperationError && error.code === 'MERCHANT_OPERATION_FORBIDDEN');
  await assert.rejects(service.extendCampaign({ ...input, merchantId: 'ops-b', accountId: 'owner-b' }),
    (error: unknown) => error instanceof MerchantOperationError && error.code === 'MERCHANT_OPERATION_NOT_FOUND');
  await assert.rejects(service.extendCampaign({ ...input, consentAccepted: false }),
    (error: unknown) => error instanceof MerchantOperationError && error.code === 'MERCHANT_OPERATION_INVALID');
  const [first, second] = await Promise.all([service.extendCampaign(input), service.extendCampaign(input)]);
  assert.equal([first.replayed, second.replayed].filter(Boolean).length, 1);
  assert.equal(first.endsAt, second.endsAt);
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM merchant_campaign_extension_audit`)).rows[0].count, 1);
  await assert.rejects(service.extendCampaign({ ...input, requestId: randomUUID() }),
    (error: unknown) => error instanceof MerchantOperationError && error.code === 'MERCHANT_OPERATION_CONFLICT');
});

test('owner approves a Google-bound request, narrows staff tasks and revokes old access', { skip }, async t => {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  await pool.query('TRUNCATE auth_identities CASCADE');
  await pool.query(`INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status)
    VALUES ('staff-a','가게 A','','서울',0,'ACTIVE'),('staff-b','가게 B','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('staff-a','owner-a','OWNER','ACTIVE'),('staff-b','owner-b','OWNER','ACTIVE')`);
  await pool.query(`INSERT INTO auth_identities (provider, subject, account_id, created_at)
    VALUES ('google','ops-staff-subject','staff-person',now())`);
  const code = randomBytes(16).toString('base64url');
  await pool.query(`INSERT INTO staff_registration_requests
    (id, merchant_id, account_id, code_hash, created_at, expires_at)
    VALUES ($1, 'staff-a', 'staff-person', $2, now(), now() + interval '15 minutes')`,
    [randomUUID(), createHash('sha256').update(code).digest()]);
  const service = new PostgresMerchantOperations(pool, { accountLifecycle: lifecycle });
  const access = new PostgresMerchantAccessControl(pool);
  await assert.rejects(service.approveStaff({ accountId: 'owner-b', merchantId: 'staff-b', code }),
    (error: unknown) => error instanceof MerchantOperationError && error.code === 'MERCHANT_OPERATION_NOT_FOUND');
  assert.equal((await service.approveStaff({ accountId: 'owner-a', merchantId: 'staff-a', code })).confirmVisit, true);
  await service.updateStaffPermissions({ accountId: 'owner-a', merchantId: 'staff-a', targetAccountId: 'staff-person',
    confirmVisit: false, redeemCoupon: true });
  await assert.rejects(access.requirePermission({ accountId: 'staff-person', merchantId: 'staff-a', permission: 'CONFIRM_VISIT' }));
  await access.requirePermission({ accountId: 'staff-person', merchantId: 'staff-a', permission: 'REDEEM_COUPON' });
  const identities = new PostgresCustomerIdentityService(pool, { accountLifecycle: lifecycle, now: () => NOW });
  const customer = await identities.create('operations-scan-customer');
  await identities.resolve({ token: customer.token, merchantId: 'staff-a', staffAccountId: 'staff-person' });
  const transaction = await pool.connect();
  try {
    await transaction.query('BEGIN');
    await assert.rejects(requireActiveMerchantMember(transaction, 'staff-a', 'staff-person', 'CONFIRM_VISIT'));
    await requireActiveMerchantMember(transaction, 'staff-a', 'staff-person', 'REDEEM_COUPON');
    await transaction.query('ROLLBACK');
  } finally { transaction.release(); }
  await assert.rejects(service.updateStaffPermissions({ accountId: 'owner-b', merchantId: 'staff-b', targetAccountId: 'staff-person',
    confirmVisit: true, redeemCoupon: true }));
  await service.revokeStaff({ accountId: 'owner-a', merchantId: 'staff-a', targetAccountId: 'staff-person' });
  await assert.rejects(identities.resolve({ token: customer.token, merchantId: 'staff-a', staffAccountId: 'staff-person' }));
  await assert.rejects(access.requirePermission({ accountId: 'staff-person', merchantId: 'staff-a', permission: 'REDEEM_COUPON' }));
  assert.deepEqual((await pool.query(`SELECT action FROM merchant_staff_action_audit ORDER BY created_at, action`))
    .rows.map(row => row.action).sort(), ['APPROVED', 'PERMISSIONS_CHANGED', 'REVOKED']);
});

test('CSV uses counted KST visits, excludes identities and neutralizes formulas', { skip }, async t => {
  const pool = new Pool({ connectionString: testUrl });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status)
    VALUES ('csv-a','가게 A','','서울',0,'ACTIVE'),('csv-b','가게 B','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('csv-a','owner-a','OWNER','ACTIVE'),('csv-a','staff-a','STAFF','ACTIVE'),
      ('csv-b','owner-b','OWNER','ACTIVE'),('csv-b','staff-b','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('csv-campaign-a','csv-a','=HYPERLINK("x")','2026-01-01','2027-01-01','ACTIVE',true,50),
      ('csv-campaign-b','csv-b','남의 캠페인','2026-01-01','2027-01-01','ACTIVE',true,50)`);
  async function visit(merchantId: string, campaignId: string, account: string, at: string,
    businessDate: string, status: 'VALID' | 'CANCELED' = 'VALID', counted = true) {
    const slotId = randomUUID();
    await pool.query(`INSERT INTO claim_slots
      (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
        token_hash, status, expires_at, claimed_at, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'CLAIMED',$7::timestamptz + interval '15 minutes',$7,
        $7::timestamptz - interval '5 minutes',$7)`,
      [slotId, merchantId, account, randomBytes(32), merchantId === 'csv-a' ? 'staff-a' : 'staff-b', randomBytes(32), at]);
    await pool.query(`INSERT INTO visit_events (id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
      occurred_at,business_date,verification_level,status,progress_counted,cancellation_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'MERCHANT_CONFIRMED',$8,$9,$10)`,
      [randomUUID(), slotId, merchantId, campaignId, account, at, businessDate, status, counted,
        status === 'CANCELED' ? 'WRONG_CUSTOMER' : null]);
  }
  await visit('csv-a','csv-campaign-a','customer-secret','2026-10-04T14:59:59Z','2026-10-04');
  await visit('csv-a','csv-campaign-a','customer-secret','2026-10-04T15:00:00Z','2026-10-05');
  await visit('csv-a','csv-campaign-a','customer-other','2026-10-04T15:01:00Z','2026-10-05','CANCELED',false);
  await visit('csv-a','csv-campaign-a','customer-other','2026-10-04T15:02:00Z','2026-10-05','VALID',false);
  await visit('csv-b','csv-campaign-b','customer-secret','2026-10-04T15:00:00Z','2026-10-05');
  const service = new PostgresMerchantOperations(pool, { accountLifecycle: lifecycle });
  await assert.rejects(service.exportVisits({ accountId: 'owner-b', merchantId: 'csv-a', fromDate: '2026-10-05', toDate: '2026-10-05' }));
  const result = await service.exportVisits({ accountId: 'owner-a', merchantId: 'csv-a', fromDate: '2026-10-05', toDate: '2026-10-05' });
  assert.equal(result.count, 1);
  assert.ok(result.csv.startsWith('\uFEFF'));
  assert.match(result.csv, /2026-10-05.*재방문/);
  assert.match(result.csv, /'=HYPERLINK/);
  assert.doesNotMatch(result.csv, /customer-secret|customer-other|남의 캠페인/);
  assert.equal(result.csv.trimEnd().split('\r\n').length, 2);
});

test('deletion lock wins over queued owner and target-staff writes without restoring raw audit identity', { skip }, async t => {
  const pool = new Pool({ connectionString: testUrl });
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants CASCADE');
  await pool.query('TRUNCATE account_deletion_requests CASCADE');
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status)
    VALUES ('race-shop','가게','','서울',0,'ACTIVE')`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('race-shop','race-owner','OWNER','ACTIVE'),('race-shop','race-staff','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('race-campaign','race-shop','캠페인','2026-09-01','2026-10-31','ACTIVE',true,50)`);
  const service = new PostgresMerchantOperations(pool, { accountLifecycle: lifecycle, now: () => NOW });
  const lock = await pool.connect();
  t.after(async () => { lock.release(); await pool.end(); });
  async function deleteDuring(accountId: string, operation: Promise<unknown>) {
    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false, 'operation must wait for deletion advisory lock');
    const referenceHash = lifecycle.referenceHash(accountId);
    await lock.query(`INSERT INTO account_deletion_requests
      (id, account_reference_hash, deleted_account_alias, status, policy_version,
        cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at)
      VALUES ($1,$2,$3,'COMPLETED','test',0,0,0,now(),now(),now())`,
      [randomUUID(), referenceHash, `deleted:${randomBytes(32).toString('hex')}`]);
    await lock.query('COMMIT');
    await assert.rejects(operation, (error: unknown) => error instanceof MerchantOperationError
      && error.code === 'MERCHANT_OPERATION_FORBIDDEN');
  }
  await lock.query('BEGIN');
  await lifecycle.lockForDeletion(lock, 'race-owner');
  await deleteDuring('race-owner', service.extendCampaign({ accountId: 'race-owner', merchantId: 'race-shop',
    campaignId: 'race-campaign', days: 30, expectedEndsAt: '2026-10-31T00:00:00.000Z',
    consentAccepted: true, requestId: randomUUID() }));
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM merchant_campaign_extension_audit`)).rows[0].count, 0);
  await pool.query(`UPDATE merchant_members SET account_id = 'race-owner-2' WHERE merchant_id = 'race-shop' AND account_id = 'race-owner'`);
  await lock.query('BEGIN');
  await lifecycle.lockForDeletion(lock, 'race-staff');
  await deleteDuring('race-staff', service.updateStaffPermissions({ accountId: 'race-owner-2', merchantId: 'race-shop',
    targetAccountId: 'race-staff', confirmVisit: false, redeemCoupon: false }));
  assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM merchant_staff_action_audit`)).rows[0].count, 0);
});
