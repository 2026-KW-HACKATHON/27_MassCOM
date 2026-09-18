import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { runMigrations } from './postgres/migrate.js';

test('one-person claim slots keep only hashes, reissue in place, and consume once under concurrency', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }

  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE');
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-a', 'A 데모 식당', 'QR 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE')`,
  );

  let currentTime = new Date('2026-09-18T03:00:00.000Z');
  const tokens = [
    'token-1-abcdefghijklmnopqrstuvwxyz012345',
    'token-2-abcdefghijklmnopqrstuvwxyz012345',
    'token-3-abcdefghijklmnopqrstuvwxyz012345',
    'token-4-abcdefghijklmnopqrstuvwxyz012345',
  ];
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const service = new PostgresClaimSlotService(pool, {
    now: () => currentTime,
    nextToken: () => tokens.shift()!,
    nextId: () => ids.shift()!,
    ttlMs: 15 * 60 * 1000,
  });

  const first = await service.issue({
    merchantId: 'merchant-a',
    customerAccountId: 'customer-1',
    merchantReference: 'demo-order-1',
    createdByAccountId: 'staff-a',
  });
  assert.deepEqual(first, {
    claimSlotId: '00000000-0000-4000-8000-000000000001',
    token: 'token-1-abcdefghijklmnopqrstuvwxyz012345',
    expiresAt: '2026-09-18T03:15:00.000Z',
  });

  const stored = await pool.query<{
    token_hash: string;
    merchant_reference_hash: string;
    token_version: number;
  }>(
    `SELECT encode(token_hash, 'hex') AS token_hash,
            encode(merchant_reference_hash, 'hex') AS merchant_reference_hash,
            token_version
     FROM claim_slots
     WHERE id = $1`,
    [first.claimSlotId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]!.token_hash.length, 64);
  assert.equal(stored.rows[0]!.merchant_reference_hash.length, 64);
  assert.doesNotMatch(JSON.stringify(stored.rows[0]), /token-1|demo-order-1/);
  assert.equal(stored.rows[0]!.token_version, 1);

  await assert.rejects(
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId: 'customer-1',
      merchantReference: 'demo-order-1',
      createdByAccountId: 'staff-a',
    }),
    { code: 'CLAIM_SLOT_ALREADY_EXISTS' },
  );

  const reissued = await service.reissue({
    merchantId: 'merchant-a',
    claimSlotId: first.claimSlotId,
    requestedByAccountId: 'staff-a',
  });
  assert.deepEqual(reissued, {
    claimSlotId: first.claimSlotId,
    token: 'token-2-abcdefghijklmnopqrstuvwxyz012345',
    expiresAt: '2026-09-18T03:15:00.000Z',
  });
  const slotCount = await pool.query<{ count: string }>('SELECT count(*) FROM claim_slots');
  assert.equal(slotCount.rows[0]!.count, '1');

  await assert.rejects(
    service.redeem({ accountId: 'customer-1', token: first.token }),
    { code: 'CLAIM_TOKEN_UNAVAILABLE' },
  );

  const preview = await service.preview({
    accountId: 'customer-1',
    token: reissued.token,
  });
  assert.deepEqual(preview, {
    claimSlotId: first.claimSlotId,
    merchantId: 'merchant-a',
    expiresAt: '2026-09-18T03:15:00.000Z',
    status: 'AVAILABLE',
  });
  const afterPreview = await pool.query<{ status: string }>(
    'SELECT status FROM claim_slots WHERE id = $1',
    [first.claimSlotId],
  );
  assert.equal(afterPreview.rows[0]!.status, 'ISSUED');

  const concurrent = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.redeem({ accountId: 'customer-1', token: reissued.token }),
    ),
  );
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 19);
  const claimed = await pool.query<{ status: string; claimed_count: string }>(
    `SELECT status, count(claimed_at)::text AS claimed_count
     FROM claim_slots
     WHERE id = $1
     GROUP BY status`,
    [first.claimSlotId],
  );
  assert.deepEqual(claimed.rows[0], { status: 'CLAIMED', claimed_count: '1' });

  const expiring = await service.issue({
    merchantId: 'merchant-a',
    customerAccountId: 'customer-2',
    merchantReference: 'demo-order-2',
    createdByAccountId: 'staff-a',
  });
  await assert.rejects(
    service.redeem({ accountId: 'different-customer', token: expiring.token }),
    { code: 'CLAIM_TOKEN_UNAVAILABLE' },
  );
  currentTime = new Date(expiring.expiresAt);
  const expiryRace = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.redeem({ accountId: 'customer-2', token: expiring.token }),
    ),
  );
  assert.equal(expiryRace.filter((result) => result.status === 'fulfilled').length, 0);
  const expiryCodes = expiryRace.map((result) =>
    result.status === 'rejected' &&
    typeof result.reason === 'object' &&
    result.reason !== null &&
    'code' in result.reason
      ? result.reason.code
      : 'UNKNOWN',
  );
  assert.equal(expiryCodes.filter((code) => code === 'CLAIM_TOKEN_EXPIRED').length, 1);
  assert.equal(expiryCodes.filter((code) => code === 'CLAIM_TOKEN_UNAVAILABLE').length, 19);
  const expired = await pool.query<{ status: string }>(
    'SELECT status FROM claim_slots WHERE id = $1',
    [expiring.claimSlotId],
  );
  assert.equal(expired.rows[0]!.status, 'EXPIRED');

  await pool.query(
    `UPDATE merchant_members
     SET status = 'REVOKED', revoked_at = now(), updated_at = now()
     WHERE merchant_id = 'merchant-a' AND account_id = 'staff-a'`,
  );
  await assert.rejects(
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId: 'customer-3',
      merchantReference: 'demo-order-3',
      createdByAccountId: 'staff-a',
    }),
    { code: 'MERCHANT_ACCESS_DENIED' },
  );
});
