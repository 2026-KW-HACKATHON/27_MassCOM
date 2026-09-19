import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from './postgres/migrate.js';
import { PostgresChallengeStore } from './postgres/wallet-challenge-store.js';
import { WalletChallengeError, type ChallengeRecord } from './wallet-challenge-service.js';

function fixtureRecord(overrides: Partial<ChallengeRecord> = {}): ChallengeRecord {
  return {
    challengeId: 'challenge-1',
    accountId: 'customer-1',
    address: '0x1000000000000000000000000000000000000001',
    chainId: 84532,
    nonce: 'abc12345def67890',
    message: 'siwe message',
    issuedAt: '2026-09-19T00:00:00.000Z',
    expiresAt: '2026-09-19T00:05:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

test('concurrent claims on the same challenge: exactly one succeeds', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(fixtureRecord());

  const results = await Promise.allSettled([store.claim('challenge-1'), store.claim('challenge-1')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(rejected.reason instanceof WalletChallengeError);
  assert.equal(rejected.reason.code, 'NONCE_IN_PROGRESS');
});

test('consume then claim rejects reuse of an already-used nonce', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(fixtureRecord({ challengeId: 'challenge-2' }));
  await store.claim('challenge-2');
  await store.consume('challenge-2');

  await assert.rejects(
    store.claim('challenge-2'),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'NONCE_ALREADY_USED',
  );
});

test('release then claim succeeds again', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(fixtureRecord({ challengeId: 'challenge-3' }));
  await store.claim('challenge-3');
  await store.release('challenge-3');
  await store.claim('challenge-3');

  const record = await store.get('challenge-3');
  assert.equal(record?.status, 'verifying');
});

test('create purges expired challenge rows', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(
    fixtureRecord({
      challengeId: 'challenge-expired',
      issuedAt: '2026-09-18T23:50:00.000Z',
      expiresAt: '2026-09-18T23:55:00.000Z',
    }),
  );

  const laterStore = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:10:00.000Z') });
  await laterStore.create(fixtureRecord({ challengeId: 'challenge-fresh' }));

  assert.equal(await store.get('challenge-expired'), undefined);
  assert.ok(await laterStore.get('challenge-fresh'));
});

test('deleteByAccount removes only that account challenges', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(fixtureRecord({ challengeId: 'challenge-owned', accountId: 'customer-owned' }));
  await store.create(fixtureRecord({ challengeId: 'challenge-other', accountId: 'customer-other' }));

  await store.deleteByAccount('customer-owned');

  assert.equal(await store.get('challenge-owned'), undefined);
  assert.ok(await store.get('challenge-other'));
});

test('create rejects a duplicate challenge id', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE wallet_challenges CASCADE');

  const store = new PostgresChallengeStore(pool, { now: () => new Date('2026-09-19T00:00:00.000Z') });
  await store.create(fixtureRecord({ challengeId: 'challenge-dup' }));

  await assert.rejects(
    store.create(fixtureRecord({ challengeId: 'challenge-dup' })),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'CHALLENGE_ID_CONFLICT',
  );
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
