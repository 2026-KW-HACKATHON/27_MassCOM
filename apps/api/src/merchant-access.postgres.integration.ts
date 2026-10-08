import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { runMigrations } from './postgres/migrate.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('Q05 allows only active members of the requested merchant and applies revocation immediately', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }

  const pool = new Pool({ connectionString });
  await runMigrations(pool);
  await pool.query('TRUNCATE merchant_members, campaign_goals, campaigns, merchants CASCADE');
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES
       ('merchant-a', 'A 데모 식당', '권한 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true),
       ('merchant-b', 'B 데모 식당', '다른 점포 권한 시험용입니다.', '서울 노원구 데모로 2', 12000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
     VALUES
       ('merchant-a', 'owner-a', 'OWNER', 'ACTIVE', NULL),
       ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE', NULL),
       ('merchant-b', 'staff-b', 'STAFF', 'ACTIVE', NULL),
       ('merchant-a', 'revoked-a', 'STAFF', 'REVOKED', now())`,
  );

  const access = new PostgresMerchantAccessControl(pool);
  const walletService = new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 5 * 60 * 1000,
  });
  const server = createApiServer(
    walletService,
    developmentHeaderAccountResolver,
    undefined,
    access,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind a TCP port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const ownerResponse = await fetch(`${baseUrl}/merchant/merchants/merchant-a/context`, {
    headers: { 'x-account-id': 'owner-a' },
  });
  assert.equal(ownerResponse.status, 200);
  assert.deepEqual(await ownerResponse.json(), {
    merchantId: 'merchant-a',
    role: 'OWNER',
    permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
  });

  const staffResponse = await fetch(`${baseUrl}/merchant/merchants/merchant-a/context`, {
    headers: { 'x-account-id': 'staff-a' },
  });
  assert.equal(staffResponse.status, 200);

  for (const accountId of ['staff-b', 'unrelated-user', 'revoked-a']) {
    const deniedResponse = await fetch(`${baseUrl}/merchant/merchants/merchant-a/context`, {
      headers: { 'x-account-id': accountId },
    });
    assert.equal(deniedResponse.status, 403, `${accountId} must not read merchant-a`);
    assert.deepEqual(await deniedResponse.json(), { code: 'MERCHANT_ACCESS_DENIED' });
  }

  await assert.rejects(
    access.requirePermission({
      accountId: 'staff-b',
      merchantId: 'merchant-a',
      permission: 'CONFIRM_VISIT',
    }),
    { code: 'MERCHANT_ACCESS_DENIED' },
  );

  await pool.query(
    `UPDATE merchant_members
     SET status = 'REVOKED', revoked_at = now(), updated_at = now()
     WHERE merchant_id = 'merchant-a' AND account_id = 'staff-a'`,
  );
  const afterRevocation = await fetch(`${baseUrl}/merchant/merchants/merchant-a/context`, {
    headers: { 'x-account-id': 'staff-a' },
  });
  assert.equal(afterRevocation.status, 403);
  assert.deepEqual(await afterRevocation.json(), { code: 'MERCHANT_ACCESS_DENIED' });
});
