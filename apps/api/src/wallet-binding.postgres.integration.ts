import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAddress, Wallet } from 'ethers';
import { Pool } from 'pg';

import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { runMigrations } from './postgres/migrate.js';
import { WalletBindingError } from './wallet-binding.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('verified wallet bindings version address changes and reject cross-account reuse', async (t) => {
  const connectionString = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_bindings CASCADE');

  let now = new Date('2026-09-19T00:00:00.000Z');
  const ids = [
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004',
  ];
  const store = new PostgresWalletBindingStore(pool, {
    now: () => now,
    nextId: () => ids.shift()!,
  });
  const firstAddress = getAddress('0x1000000000000000000000000000000000000001');
  const changedAddress = getAddress('0x2000000000000000000000000000000000000002');

  const first = await store.recordVerified({
    accountId: 'customer-1',
    address: firstAddress,
    chainId: 84532,
  });
  assert.deepEqual(first, {
    bindingId: '30000000-0000-4000-8000-000000000001',
    bindingVersion: 1,
    address: firstAddress,
    chainId: 84532,
    verifiedAt: '2026-09-19T00:00:00.000Z',
  });

  now = new Date('2026-09-19T00:01:00.000Z');
  const repeated = await store.recordVerified({
    accountId: 'customer-1',
    address: firstAddress,
    chainId: 84532,
  });
  assert.equal(repeated.bindingId, first.bindingId);
  assert.equal(repeated.bindingVersion, first.bindingVersion);
  assert.equal(repeated.verifiedAt, '2026-09-19T00:01:00.000Z');

  now = new Date('2026-09-19T00:02:00.000Z');
  const changed = await store.recordVerified({
    accountId: 'customer-1',
    address: changedAddress,
    chainId: 84532,
  });
  assert.equal(changed.bindingId, '30000000-0000-4000-8000-000000000002');
  assert.equal(changed.bindingVersion, 2);

  const rows = await pool.query<{
    id: string;
    status: string;
    binding_version: number;
    disconnected_at: Date | null;
  }>(
    `SELECT id, status, binding_version, disconnected_at
     FROM wallet_bindings
     WHERE account_id = 'customer-1'
     ORDER BY binding_version`,
  );
  assert.equal(rows.rows[0]?.status, 'DISCONNECTED');
  assert.ok(rows.rows[0]?.disconnected_at);
  assert.equal(rows.rows[1]?.status, 'VERIFIED');

  const sharedAddress = getAddress('0x3000000000000000000000000000000000000003');
  const race = await Promise.allSettled([
    store.recordVerified({ accountId: 'customer-2', address: sharedAddress, chainId: 84532 }),
    store.recordVerified({ accountId: 'customer-3', address: sharedAddress, chainId: 84532 }),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter((result) => result.status === 'rejected').length, 1);
  const rejected = race.find((result) => result.status === 'rejected');
  if (rejected?.status === 'rejected') {
    assert.ok(rejected.reason instanceof WalletBindingError);
    assert.equal(rejected.reason.code, 'WALLET_ADDRESS_IN_USE');
  }

  await store.disconnect({
    accountId: 'customer-1',
    bindingId: changed.bindingId,
    bindingVersion: changed.bindingVersion,
  });
  assert.equal(await store.getActive('customer-1'), undefined);

  now = new Date('2026-09-19T00:03:00.000Z');
  const signedWallet = Wallet.createRandom();
  const challengeService = new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    bindingStore: store,
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 5 * 60 * 1000,
    now: () => new Date('2026-09-19T00:03:00.000Z'),
    nonce: () => 'abc12345def67890',
    challengeId: () => 'challenge-postgres-binding',
  });
  const challenge = await challengeService.createChallenge({
    accountId: 'customer-4',
    address: signedWallet.address,
    chainId: 84532,
  });
  const signature = await signedWallet.signMessage(challenge.message);
  const verification = await challengeService.verifyChallenge({
    accountId: 'customer-4',
    challengeId: challenge.challengeId,
    message: challenge.message,
    signature,
    currentAddress: signedWallet.address,
  });
  const persisted = await store.getActive('customer-4');
  assert.equal(persisted?.bindingId, verification.walletBindingId);
  assert.equal(persisted?.bindingVersion, verification.bindingVersion);
  assert.equal(persisted?.address, signedWallet.address);
});

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}
