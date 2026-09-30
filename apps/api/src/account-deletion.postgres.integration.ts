import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { AuthSessionError } from './auth-session.js';
import { ClaimSlotError } from './claim-slot-service.js';
import { MintRequestError } from './mint-request-service.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { WalletBindingError } from './wallet-binding.js';

test('D01 concurrent deletion cancels only unsent mint work and pseudonymizes the account', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query(
    `INSERT INTO wallet_challenges (
       id, account_id, address, chain_id, nonce, message, issued_at, expires_at, status
     ) VALUES (
       'challenge-delete-me', 'delete-me', '0x7000000000000000000000000000000000000007', 84532,
       'abc12345def67890', 'pending wallet verification', now(), now() + interval '5 minutes', 'pending'
     )`,
  );

  const service = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    nextRequestId: () => '90000000-0000-4000-8000-000000000001',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });

  const requests = await Promise.all(
    Array.from({ length: 10 }, () =>
      service.requestDeletion({
        accountId: 'delete-me',
        confirmation: 'DELETE MY ACCOUNT',
      }),
    ),
  );
  assert.equal(new Set(requests.map((request) => request.requestId)).size, 1);
  assert.equal(requests.filter((request) => request.replayed === false).length, 1);
  assert.equal(requests.filter((request) => request.replayed === true).length, 9);
  assert.deepEqual(
    requests.map(({ status, cancelledMintJobs, pendingMintJobs, retainedFinalizedNfts }) => ({
      status,
      cancelledMintJobs,
      pendingMintJobs,
      retainedFinalizedNfts,
    })),
    Array.from({ length: 10 }, () => ({
      status: 'WAITING_FOR_MINT_FINALITY',
      cancelledMintJobs: 1,
      pendingMintJobs: 1,
      retainedFinalizedNfts: 1,
    })),
  );

  const state = await pool.query<{
    raw_account_references: number;
    disconnected_bindings: number;
    queued_status: string;
    queued_entitlement_status: string;
    queued_outbox_status: string;
    submitted_status: string;
    finalized_status: string;
    deletion_hash_bytes: number;
    deleted_alias: string;
  }>(
    `SELECT
       (
         (SELECT count(*) FROM merchant_members WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM claim_slots WHERE customer_account_id = 'delete-me' OR created_by_account_id = 'delete-me') +
         (SELECT count(*) FROM visit_events WHERE customer_account_id = 'delete-me') +
         (SELECT count(*) FROM reward_entitlements WHERE customer_account_id = 'delete-me') +
         (SELECT count(*) FROM wallet_bindings WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM wallet_challenges WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM mint_jobs WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM campaign_enrollments WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM badge_coupons
          WHERE customer_account_id = 'delete-me' OR redeemed_by_account_id = 'delete-me')
       )::integer AS raw_account_references,
       (SELECT count(*)::integer FROM wallet_bindings WHERE status = 'DISCONNECTED') AS disconnected_bindings,
       (SELECT status FROM mint_jobs WHERE id = '40000000-0000-4000-8004-000000000001') AS queued_status,
       (SELECT status FROM reward_entitlements WHERE id = '20000000-0000-4000-8004-000000000001') AS queued_entitlement_status,
       (SELECT status FROM outbox_events WHERE aggregate_id = '40000000-0000-4000-8004-000000000001') AS queued_outbox_status,
       (SELECT status FROM mint_jobs WHERE id = '40000000-0000-4000-8004-000000000002') AS submitted_status,
       (SELECT status FROM mint_jobs WHERE id = '40000000-0000-4000-8004-000000000003') AS finalized_status,
       (SELECT octet_length(account_reference_hash) FROM account_deletion_requests) AS deletion_hash_bytes,
       (SELECT deleted_account_alias FROM account_deletion_requests) AS deleted_alias`,
  );
  assert.equal(state.rows[0]?.raw_account_references, 0);
  assert.equal(state.rows[0]?.disconnected_bindings, 3);
  assert.equal(state.rows[0]?.queued_status, 'CANCELLED');
  assert.equal(state.rows[0]?.queued_entitlement_status, 'CANCELED');
  assert.equal(state.rows[0]?.queued_outbox_status, 'PUBLISHED');
  assert.equal(state.rows[0]?.submitted_status, 'SUBMITTED');
  assert.equal(state.rows[0]?.finalized_status, 'FINALIZED');
  assert.equal(state.rows[0]?.deletion_hash_bytes, 32);
  assert.match(state.rows[0]!.deleted_alias, /^deleted:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(state.rows[0]).includes('delete-me'), false);

  await pool.query(
    `UPDATE mint_jobs
     SET status = 'FINALIZED', finalized_at = '2026-09-19T15:05:00Z', updated_at = '2026-09-19T15:05:00Z'
     WHERE id = '40000000-0000-4000-8004-000000000002'`,
  );
  const completed = await service.requestDeletion({
    accountId: 'delete-me',
    confirmation: 'DELETE MY ACCOUNT',
  });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.replayed, true);
  assert.equal(completed.completedAt, '2026-09-19T15:00:00.000Z');
});

test('D01 preserves a retryable job when submission outcome is unknown', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query(
    `UPDATE mint_jobs
     SET status = 'RETRYABLE', last_error_code = 'MINT_SUBMISSION_RESPONSE_LOST'
     WHERE id = '40000000-0000-4000-8004-000000000001'`,
  );
  const service = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    nextRequestId: () => '90000000-0000-4000-8000-000000000002',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });

  const result = await service.requestDeletion({
    accountId: 'delete-me',
    confirmation: 'DELETE MY ACCOUNT',
  });

  assert.equal(result.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(result.cancelledMintJobs, 0);
  assert.equal(result.pendingMintJobs, 2);
  const unknown = await pool.query<{ status: string; outbox_status: string }>(
    `SELECT job.status, outbox.status AS outbox_status
     FROM mint_jobs AS job
     JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
     WHERE job.id = '40000000-0000-4000-8004-000000000001'`,
  );
  assert.deepEqual(unknown.rows[0], {
    status: 'RETRYABLE',
    outbox_status: 'PENDING',
  });
});

test('D01 keeps an actively leased prepared job pending instead of cancelling it', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query(
    `UPDATE mint_jobs
     SET status = 'PREPARED', updated_at = '2026-09-19T14:59:00Z'
     WHERE id = '40000000-0000-4000-8004-000000000001'`,
  );
  await pool.query(
    `UPDATE outbox_events
     SET status = 'LEASED', lease_owner = 'active-worker',
         lease_expires_at = '2026-09-19T15:05:00Z', updated_at = '2026-09-19T14:59:00Z'
     WHERE aggregate_id = '40000000-0000-4000-8004-000000000001'`,
  );
  const service = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    nextRequestId: () => '90000000-0000-4000-8000-000000000003',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });

  const result = await service.requestDeletion({
    accountId: 'delete-me',
    confirmation: 'DELETE MY ACCOUNT',
  });

  assert.equal(result.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(result.cancelledMintJobs, 0);
  assert.equal(result.pendingMintJobs, 2);
  const leased = await pool.query<{ job_status: string; outbox_status: string; lease_owner: string }>(
    `SELECT job.status AS job_status, outbox.status AS outbox_status, outbox.lease_owner
     FROM mint_jobs AS job
     JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
     WHERE job.id = '40000000-0000-4000-8004-000000000001'`,
  );
  assert.deepEqual(leased.rows[0], {
    job_status: 'PREPARED',
    outbox_status: 'LEASED',
    lease_owner: 'active-worker',
  });
});

test('D01 keeps a prepared mint pending after its lease expires until terminal mint outcomes', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query(
    `UPDATE mint_jobs SET status = 'PREPARED'
     WHERE id = '40000000-0000-4000-8004-000000000001'`,
  );
  await pool.query(
    `UPDATE outbox_events
     SET status = 'LEASED', lease_owner = 'active-worker',
         lease_expires_at = '2026-09-19T15:05:00Z'
     WHERE aggregate_id = '40000000-0000-4000-8004-000000000001'`,
  );
  let now = new Date('2026-09-19T15:00:00.000Z');
  const service = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    nextRequestId: () => '90000000-0000-4000-8000-000000000007',
    now: () => now,
    policyVersion: 'account-deletion-v1',
  });

  const initial = await service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal(initial.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(initial.pendingMintJobs, 2);

  now = new Date('2026-09-19T15:06:00.000Z');
  const expired = await service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal(expired.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(expired.pendingMintJobs, 2);
  assert.equal(expired.completedAt, null);

  await pool.query(
    `UPDATE mint_jobs SET status = 'CANCELLED'
     WHERE id = '40000000-0000-4000-8004-000000000001'`,
  );
  const remaining = await service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal(remaining.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(remaining.pendingMintJobs, 1);

  await pool.query(
    `UPDATE mint_jobs
     SET status = 'FINALIZED', finalized_at = $1
     WHERE id = '40000000-0000-4000-8004-000000000002'`,
    [now],
  );
  const completed = await service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.pendingMintJobs, 0);
  assert.equal(completed.completedAt, now.toISOString());
});

test('D26 deletion transaction rechecks the bearer session before changing account data', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query('TRUNCATE auth_sessions CASCADE');
  const token = 'signed-recent-auth-test-token';
  const authTime = new Date('2026-09-19T14:55:01.000Z');
  await pool.query(
    `INSERT INTO auth_sessions (
       id, account_id, token_hash, created_at, expires_at, last_authenticated_at
     ) VALUES ($1, 'delete-me', $2, $3, $4, $5)`,
    [
      '80000000-0000-4000-8000-000000000001',
      createHash('sha256').update(token).digest(),
      new Date('2026-09-19T14:00:00.000Z'),
      new Date('2026-09-20T15:00:00.000Z'),
      authTime,
    ],
  );
  let now = new Date('2026-09-19T15:00:00.000Z');
  const service = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    nextRequestId: () => '90000000-0000-4000-8000-000000000008',
    now: () => now,
    policyVersion: 'account-deletion-v1',
    requireRecentSession: true,
  });

  // The bearer was recent when the HTTP guard ran; time advances before the DB transaction.
  now = new Date('2026-09-19T15:00:02.000Z');
  await assert.rejects(
    service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT', sessionToken: token }),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'REAUTHENTICATION_REQUIRED',
  );
  await assert.rejects(
    service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' }),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_REQUIRED',
  );
  await pool.query(
    `UPDATE auth_sessions SET last_authenticated_at = $1, account_id = 'other-account'
     WHERE id = '80000000-0000-4000-8000-000000000001'`,
    [now],
  );
  await assert.rejects(
    service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT', sessionToken: token }),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'IDENTITY_MISMATCH',
  );
  await pool.query(
    `UPDATE auth_sessions SET account_id = 'delete-me', revoked_at = $1
     WHERE id = '80000000-0000-4000-8000-000000000001'`,
    [now],
  );
  await assert.rejects(
    service.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT', sessionToken: token }),
    (error: unknown) => error instanceof AuthSessionError && error.code === 'SESSION_INVALID',
  );
  const unchanged = await pool.query('SELECT 1 FROM account_deletion_requests');
  assert.equal(unchanged.rowCount, 0);

  await pool.query(
    `UPDATE auth_sessions SET revoked_at = NULL
     WHERE id = '80000000-0000-4000-8000-000000000001'`,
  );
  const accepted = await service.requestDeletion({
    accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT', sessionToken: token,
  });
  assert.equal(accepted.status, 'WAITING_FOR_MINT_FINALITY');
});

test('D26 deletion rechecks authentication after waiting for a locked session row', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  const token = 'session-row-lock-test-token';
  const tokenHash = createHash('sha256').update(token).digest();

  for (const scenario of [
    {
      authTime: '2026-09-19T14:55:01.000Z',
      expiresAt: '2026-09-19T15:01:00.000Z',
      expectedCode: 'REAUTHENTICATION_REQUIRED',
    },
    {
      authTime: '2026-09-19T14:59:00.000Z',
      expiresAt: '2026-09-19T15:00:01.000Z',
      expectedCode: 'SESSION_INVALID',
    },
  ]) {
    await seedDeletionFixture(pool);
    await pool.query('TRUNCATE auth_sessions CASCADE');
    await pool.query(
      `INSERT INTO auth_sessions (
         id, account_id, token_hash, created_at, expires_at, last_authenticated_at
       ) VALUES ($1, 'delete-me', $2, $3, $4, $5)`,
      [
        '80000000-0000-4000-8000-000000000002', tokenHash,
        new Date('2026-09-19T14:00:00.000Z'), new Date(scenario.expiresAt),
        new Date(scenario.authTime),
      ],
    );
    let now = new Date('2026-09-19T15:00:00.000Z');
    const service = new PostgresAccountDeletionService(pool, {
      hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
      now: () => now,
      policyVersion: 'account-deletion-v1',
      requireRecentSession: true,
    });
    const blocker = await pool.connect();
    const monitor = await pool.connect();
    await blocker.query('BEGIN');
    let pending: Promise<{ error?: unknown }> | undefined;
    try {
      await blocker.query('SELECT 1 FROM auth_sessions WHERE token_hash = $1 FOR UPDATE', [tokenHash]);
      pending = service.requestDeletion({
        accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT', sessionToken: token,
      }).then(() => ({}), (error: unknown) => ({ error }));

      let waiting = false;
      const deadline = Date.now() + 5000;
      while (!waiting && Date.now() < deadline) {
        const activity = await monitor.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE pid <> pg_backend_pid()
               AND wait_event_type = 'Lock'
               AND query LIKE '%auth_sessions%FOR UPDATE%'
           ) AS waiting`,
        );
        waiting = activity.rows[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'deletion did not wait on the session row lock');
      now = new Date('2026-09-19T15:00:02.000Z');
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      monitor.release();
    }
    const outcome = await pending;
    assert.ok(
      outcome?.error instanceof AuthSessionError && outcome.error.code === scenario.expectedCode,
      `expected ${scenario.expectedCode} after the row lock wait`,
    );
    const unchanged = await pool.query('SELECT 1 FROM account_deletion_requests');
    assert.equal(unchanged.rowCount, 0);
  }
});

test('deleted account tombstone rejects wallet, claim, redeem, and mint writes', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  const accountLifecycle = new PostgresAccountLifecycle({
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
  });
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    accountLifecycle,
    nextRequestId: () => '90000000-0000-4000-8000-000000000004',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });
  await deletion.requestDeletion({
    accountId: 'delete-me',
    confirmation: 'DELETE MY ACCOUNT',
  });

  const walletBindings = new PostgresWalletBindingStore(pool, { accountLifecycle });
  await assert.rejects(
    walletBindings.recordVerified({
      accountId: 'delete-me',
      address: '0x9000000000000000000000000000000000000009',
      chainId: 31337,
    }),
    (error: unknown) => error instanceof WalletBindingError && error.code === 'ACCOUNT_DELETED',
  );

  const claimSlots = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'test-only-reference-secret-at-least-32-bytes',
    accountLifecycle,
  });
  await assert.rejects(
    claimSlots.issue({
      merchantId: 'merchant-delete',
      customerAccountId: 'customer-other',
      merchantReference: 'deleted-customer-order',
      createdByAccountId: 'delete-me',
    }),
    (error: unknown) => error instanceof ClaimSlotError && error.code === 'ACCOUNT_DELETED',
  );
  await assert.rejects(
    claimSlots.reissue({
      merchantId: 'merchant-delete',
      claimSlotId: '00000000-0000-4000-8004-000000000001',
      expectedTokenVersion: 1,
      requestedByAccountId: 'delete-me',
    }),
    (error: unknown) => error instanceof ClaimSlotError && error.code === 'ACCOUNT_DELETED',
  );
  await assert.rejects(
    claimSlots.redeem({ accountId: 'delete-me', token: 'deleted-token' }),
    (error: unknown) => error instanceof ClaimSlotError && error.code === 'ACCOUNT_DELETED',
  );

  const mintRequests = new PostgresMintRequestService(pool, {
    supportedConsentVersion: 'nft-mint-v1',
    accountLifecycle,
  });
  await assert.rejects(
    mintRequests.requestMint({
      accountId: 'delete-me',
      entitlementId: '20000000-0000-4000-8004-000000000001',
      walletBindingId: '30000000-0000-4000-8004-000000000003',
      bindingVersion: 3,
      consentVersion: 'nft-mint-v1',
      idempotencyKey: 'deleted-account-mint',
    }),
    (error: unknown) => error instanceof MintRequestError && error.code === 'ACCOUNT_DELETED',
  );
});

test('concurrent deletion and mint request leave no active work under the original account', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  await pool.query('TRUNCATE nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs CASCADE');
  await pool.query(
    `DELETE FROM reward_entitlements
     WHERE id <> '20000000-0000-4000-8004-000000000001'`,
  );
  await pool.query(
    `UPDATE reward_entitlements
     SET status = 'GRANTED'
     WHERE id = '20000000-0000-4000-8004-000000000001'`,
  );
  const accountLifecycle = new PostgresAccountLifecycle({
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
  });
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    accountLifecycle,
    nextRequestId: () => '90000000-0000-4000-8000-000000000005',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });
  const mintRequests = new PostgresMintRequestService(pool, {
    supportedConsentVersion: 'nft-mint-v1',
    accountLifecycle,
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    nextJobId: () => '40000000-0000-4000-8005-000000000001',
    nextOutboxId: () => '50000000-0000-4000-8005-000000000001',
    nextRewardKey: () => Buffer.from('77'.repeat(32), 'hex'),
  });

  const [deletionResult, mintResult] = await Promise.allSettled([
    deletion.requestDeletion({
      accountId: 'delete-me',
      confirmation: 'DELETE MY ACCOUNT',
    }),
    mintRequests.requestMint({
      accountId: 'delete-me',
      entitlementId: '20000000-0000-4000-8004-000000000001',
      walletBindingId: '30000000-0000-4000-8004-000000000003',
      bindingVersion: 3,
      consentVersion: 'nft-mint-v1',
      idempotencyKey: 'deletion-race-mint',
    }),
  ]);

  assert.equal(deletionResult.status, 'fulfilled');
  if (mintResult.status === 'rejected') {
    assert.ok(
      mintResult.reason instanceof MintRequestError &&
        ['ACCOUNT_DELETED', 'ENTITLEMENT_NOT_FOUND'].includes(mintResult.reason.code),
    );
  }
  const state = await pool.query<{
    raw_references: number;
    active_jobs: number;
    pending_outbox: number;
  }>(
    `SELECT
       (
         (SELECT count(*) FROM reward_entitlements WHERE customer_account_id = 'delete-me') +
         (SELECT count(*) FROM wallet_bindings WHERE account_id = 'delete-me') +
         (SELECT count(*) FROM mint_jobs WHERE account_id = 'delete-me')
       )::integer AS raw_references,
       (SELECT count(*)::integer FROM mint_jobs WHERE status NOT IN ('CANCELLED', 'FINALIZED')) AS active_jobs,
       (SELECT count(*)::integer FROM outbox_events WHERE status IN ('PENDING', 'LEASED')) AS pending_outbox`,
  );
  assert.deepEqual(state.rows[0], {
    raw_references: 0,
    active_jobs: 0,
    pending_outbox: 0,
  });
});

test('concurrent staff deletion and claim issue leave no original creator reference', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await seedDeletionFixture(pool);
  const accountLifecycle = new PostgresAccountLifecycle({
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
  });
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    accountLifecycle,
    nextRequestId: () => '90000000-0000-4000-8000-000000000006',
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    policyVersion: 'account-deletion-v1',
  });
  const claimSlots = new PostgresClaimSlotService(pool, {
    referenceHmacSecret: 'test-only-reference-secret-at-least-32-bytes',
    accountLifecycle,
    now: () => new Date('2026-09-19T15:00:00.000Z'),
    nextToken: () => 'creator-race-token-abcdefghijklmnopqrstuvwxyz',
    nextId: () => '00000000-0000-4000-8006-000000000001',
  });

  const [deletionResult, issueResult] = await Promise.allSettled([
    deletion.requestDeletion({
      accountId: 'delete-me',
      confirmation: 'DELETE MY ACCOUNT',
    }),
    claimSlots.issue({
      merchantId: 'merchant-delete',
      customerAccountId: 'customer-other',
      merchantReference: 'creator-deletion-race',
      createdByAccountId: 'delete-me',
    }),
  ]);

  assert.equal(deletionResult.status, 'fulfilled');
  if (issueResult.status === 'rejected') {
    assert.ok(
      (issueResult.reason instanceof ClaimSlotError && issueResult.reason.code === 'ACCOUNT_DELETED') ||
        issueResult.reason?.code === 'MERCHANT_ACCESS_DENIED',
    );
  }
  const remaining = await pool.query<{ raw_creators: number; raw_members: number }>(
    `SELECT
       (SELECT count(*)::integer FROM claim_slots WHERE created_by_account_id = 'delete-me') AS raw_creators,
       (SELECT count(*)::integer FROM merchant_members WHERE account_id = 'delete-me') AS raw_members`,
  );
  assert.deepEqual(remaining.rows[0], { raw_creators: 0, raw_members: 0 });
});

async function seedDeletionFixture(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE account_deletion_requests, wallet_challenges, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, campaign_enrollments, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-delete', '삭제 시험 식당', '삭제 시험용입니다.', '서울 노원구 데모로 12', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-delete', 'delete-me', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns (
       id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity
     ) VALUES (
       'campaign-delete', 'merchant-delete', '삭제 도감', '2026-09-01T00:00:00Z',
       '2026-10-31T23:59:59Z', 'ACTIVE', true, 10
     )`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES
       ('campaign-delete', 1, '삭제 1회'),
       ('campaign-delete', 3, '삭제 3회'),
       ('campaign-delete', 5, '삭제 5회')`,
  );
  await pool.query(
    `INSERT INTO campaign_enrollments (id, campaign_id, account_id, enrolled_at)
     VALUES ('60000000-0000-4000-8004-000000000001', 'campaign-delete', 'delete-me', '2026-09-10T03:00:00Z')`,
  );
  // 보상 쿠폰의 고객·사용 처리자 두 계정 열이 모두 가명 처리되는지 확인하는 고정 행.
  await pool.query(
    `INSERT INTO badge_reward_offers (
       id, milestone, merchant_id, title, detail, valid_days, issued_count, status, consent_note
     ) VALUES (
       '50000000-0000-4000-8004-000000000001', 1, 'merchant-delete', '삭제 시험 혜택', '시험', 30, 1,
       'ACTIVE', '시험 동의 기록'
     )`,
  );
  await pool.query(
    `INSERT INTO badge_coupons (
       id, customer_account_id, milestone, offer_id, merchant_id, title, detail, status,
       issued_at, expires_at, redeemed_at, redeemed_by_account_id
     ) VALUES (
       '50000000-0000-4000-8004-000000000002', 'delete-me', 1,
       '50000000-0000-4000-8004-000000000001', 'merchant-delete', '삭제 시험 혜택', '시험', 'REDEEMED',
       '2026-09-10T03:00:00Z', '2026-10-10T03:00:00Z', '2026-09-11T03:00:00Z', 'delete-me'
     )`,
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES
       ('s-0000000000000000000000000000d001', 'campaign-delete', 1, 31337,
        '0x7000000000000000000000000000000000000007',
        '0x7000000000000000000000000000000000000007', decode(repeat('41', 32), 'hex'), 10, 'ACTIVE'),
       ('s-0000000000000000000000000000d003', 'campaign-delete', 3, 31337,
        '0x7000000000000000000000000000000000000007',
        '0x7000000000000000000000000000000000000007', decode(repeat('43', 32), 'hex'), 10, 'ACTIVE'),
       ('s-0000000000000000000000000000d005', 'campaign-delete', 5, 31337,
        '0x7000000000000000000000000000000000000007',
        '0x7000000000000000000000000000000000000007', decode(repeat('45', 32), 'hex'), 10, 'ACTIVE')`,
  );

  for (let index = 1; index <= 3; index++) {
    const suffix = String(index).padStart(12, '0');
    const target = ([1, 3, 5] as const)[index - 1]!;
    const timestamp = `2026-09-1${index}T03:00:00Z`;
    await pool.query(
      `INSERT INTO claim_slots (
         id, merchant_id, customer_account_id, merchant_reference_hash,
         created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
       ) VALUES (
         $1, 'merchant-delete', 'delete-me', decode(repeat($2, 32), 'hex'),
         'delete-me', decode(repeat($3, 32), 'hex'), 'CLAIMED',
         $4::timestamptz + interval '15 minutes', $4, $4::timestamptz - interval '5 minutes', $4
       )`,
      [
        `00000000-0000-4000-8004-${suffix}`,
        String(index).repeat(2),
        String(index + 3).repeat(2),
        timestamp,
      ],
    );
    await pool.query(
      `INSERT INTO visit_events (
         id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
         occurred_at, business_date, verification_level, status, progress_counted
       ) VALUES (
         $1, $2, 'merchant-delete', 'campaign-delete', 'delete-me',
         $3::timestamptz, ($3::timestamptz)::date, 'MERCHANT_CONFIRMED', 'VALID', true
       )`,
      [`10000000-0000-4000-8004-${suffix}`, `00000000-0000-4000-8004-${suffix}`, timestamp],
    );
    await pool.query(
      `INSERT INTO reward_entitlements (
         id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
         status, policy_version, earned_at, claim_expires_at
       ) VALUES (
         $1, 'delete-me', 'campaign-delete', $2, $3, $4, 'fixed-1', $5,
         $5::timestamptz + interval '90 days'
       )`,
      [
        `20000000-0000-4000-8004-${suffix}`,
        target,
        `10000000-0000-4000-8004-${suffix}`,
        index === 3 ? 'FULFILLED' : 'MINT_REQUESTED',
        timestamp,
      ],
    );
    await pool.query(
      `INSERT INTO wallet_bindings (
         id, account_id, address_checksum, address_normalized, chain_id,
         binding_version, status, verified_at, disconnected_at, created_at, updated_at
       ) VALUES ($1, 'delete-me', $2, $2, 31337, $3, $4, $5, $6, $5, $5)`,
      [
        `30000000-0000-4000-8004-${suffix}`,
        `0x${String(index).repeat(40)}`,
        index,
        index === 3 ? 'VERIFIED' : 'DISCONNECTED',
        timestamp,
        index === 3 ? null : timestamp,
      ],
    );
    const status = index === 1 ? 'QUEUED' : index === 2 ? 'SUBMITTED' : 'FINALIZED';
    const transactionHash = index === 1 ? null : `0x${String(index + 6).repeat(64)}`;
    await pool.query(
      `INSERT INTO mint_jobs (
         id, entitlement_id, account_id, nft_series_id, reward_key,
         wallet_binding_id, binding_version, recipient_address,
         recipient_address_normalized, chain_id, contract_address,
         contract_address_normalized, series_key, consent_version,
         idempotency_key, request_fingerprint, status, transaction_hash,
         token_id, finalized_at, created_at, updated_at
       ) VALUES (
         $1, $2, 'delete-me', $3, decode(repeat($4, 32), 'hex'),
         $5, $6, $7, $7, 31337,
         '0x7000000000000000000000000000000000000007',
         '0x7000000000000000000000000000000000000007', decode(repeat($8, 32), 'hex'),
         'nft-mint-v1', $9, decode(repeat($10, 32), 'hex'), $11, $12,
         $13::numeric, $14, $15, $15
       )`,
      [
        `40000000-0000-4000-8004-${suffix}`,
        `20000000-0000-4000-8004-${suffix}`,
        `s-${'0'.repeat(28)}d00${target}`,
        String(index + 1).repeat(2),
        `30000000-0000-4000-8004-${suffix}`,
        index,
        `0x${String(index).repeat(40)}`,
        String(40 + target),
        `delete-idempotency-${index}`,
        String(index + 4).repeat(2),
        status,
        transactionHash,
        index === 3 ? '1' : null,
        index === 3 ? timestamp : null,
        timestamp,
      ],
    );
    await pool.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status,
         available_at, created_at, updated_at
       ) VALUES ($1, 'MINT_JOB', $2, 'MINT_REQUESTED', $3, $4, $5, $5, $5)`,
      [
        `50000000-0000-4000-8004-${suffix}`,
        `40000000-0000-4000-8004-${suffix}`,
        { jobId: `40000000-0000-4000-8004-${suffix}` },
        index === 3 ? 'PUBLISHED' : 'PENDING',
        timestamp,
      ],
    );
  }
}

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}
