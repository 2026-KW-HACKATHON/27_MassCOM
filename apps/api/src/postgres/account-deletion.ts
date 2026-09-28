import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AuthSessionError } from '../auth-session.js';
import {
  AccountDeletionError,
  type AccountDeletionResult,
  type AccountDeletionService,
  type AccountDeletionStatus,
} from '../account-deletion.js';
import { PostgresAccountLifecycle } from './account-lifecycle.js';

type Options = {
  hmacSecret: string;
  policyVersion: string;
  requireRecentSession: boolean;
  nextRequestId: () => string;
  now: () => Date;
};

type ServiceOptions = Pick<Options, 'hmacSecret' | 'policyVersion'> &
  Partial<typeof defaultOptions> & {
    accountLifecycle?: PostgresAccountLifecycle;
  };

type RequestRow = {
  id: string;
  deleted_account_alias: string;
  status: AccountDeletionStatus;
  cancelled_mint_jobs: number;
  pending_mint_jobs: number;
  retained_finalized_nfts: number;
  requested_at: Date;
  completed_at: Date | null;
};

const defaultOptions = {
  nextRequestId: () => randomUUID(),
  now: () => new Date(),
  requireRecentSession: false,
};

export class PostgresAccountDeletionService implements AccountDeletionService {
  private readonly options: Options;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(
    private readonly pool: Pool,
    options: ServiceOptions,
  ) {
    this.options = { ...defaultOptions, ...options };
    if (Buffer.byteLength(this.options.hmacSecret) < 32) {
      throw new Error('account deletion HMAC secret must be at least 32 bytes');
    }
    if (!this.options.policyVersion.trim()) {
      throw new Error('account deletion policy version is required');
    }
    this.accountLifecycle =
      options.accountLifecycle ??
      new PostgresAccountLifecycle({ hmacSecret: this.options.hmacSecret });
  }

  async requestDeletion(input: {
    accountId: string;
    confirmation: string;
    sessionToken?: string;
  }): Promise<AccountDeletionResult> {
    if (!input.accountId.trim()) throw new AccountDeletionError('ACCOUNT_REQUIRED');
    if (input.confirmation !== 'DELETE MY ACCOUNT') {
      throw new AccountDeletionError('DELETION_CONFIRMATION_REQUIRED');
    }
    if (this.options.requireRecentSession && !input.sessionToken?.trim()) {
      throw new AuthSessionError('SESSION_REQUIRED');
    }

    const referenceHash = this.accountLifecycle.referenceHash(input.accountId);
    const deletedAlias = `deleted:${referenceHash.toString('hex')}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.lockForDeletion(client, input.accountId);
      const now = this.options.now();
      if (input.sessionToken) {
        await assertRecentSession(client, input.accountId, input.sessionToken, now);
      }

      const existing = await findRequest(client, referenceHash);
      if (existing) {
        const reconciled = await reconcileExistingRequest(client, existing, now);
        await client.query('COMMIT');
        return mapResult(reconciled, true);
      }

      const counts = await mintCounts(client, input.accountId, now);
      await cancelUnsentMintJobs(client, input.accountId, now);
      await pseudonymizeAccount(client, input.accountId, deletedAlias, now);

      const status: AccountDeletionStatus =
        counts.pendingMintJobs > 0 ? 'WAITING_FOR_MINT_FINALITY' : 'COMPLETED';
      const inserted = (
        await client.query<RequestRow>(
          `INSERT INTO account_deletion_requests (
             id, account_reference_hash, deleted_account_alias, status, policy_version,
             cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts,
             requested_at, completed_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)
           RETURNING id, deleted_account_alias, status, cancelled_mint_jobs,
                     pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at`,
          [
            this.options.nextRequestId(),
            referenceHash,
            deletedAlias,
            status,
            this.options.policyVersion,
            counts.cancelledMintJobs,
            counts.pendingMintJobs,
            counts.retainedFinalizedNfts,
            now,
            status === 'COMPLETED' ? now : null,
          ],
        )
      ).rows[0]!;
      await client.query('COMMIT');
      return mapResult(inserted, false);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertRecentSession(
  client: PoolClient,
  accountId: string,
  sessionToken: string,
  now: Date,
): Promise<void> {
  const session = (
    await client.query<{ account_id: string; last_authenticated_at: Date }>(
      `SELECT account_id, last_authenticated_at
       FROM auth_sessions
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2
       FOR UPDATE`,
      [createHash('sha256').update(sessionToken).digest(), now],
    )
  ).rows[0];
  if (!session) throw new AuthSessionError('SESSION_INVALID');
  if (session.account_id !== accountId) throw new AuthSessionError('IDENTITY_MISMATCH');
  const authenticatedAt = session.last_authenticated_at.getTime();
  if (authenticatedAt > now.getTime() || authenticatedAt < now.getTime() - 5 * 60 * 1000) {
    throw new AuthSessionError('REAUTHENTICATION_REQUIRED');
  }
}

async function mintCounts(
  client: PoolClient,
  accountId: string,
  now: Date,
): Promise<{
  cancelledMintJobs: number;
  pendingMintJobs: number;
  retainedFinalizedNfts: number;
}> {
  const row = (
    await client.query<{
      cancelled_mint_jobs: number;
      pending_mint_jobs: number;
      retained_finalized_nfts: number;
    }>(
      `SELECT
         count(*) FILTER (
           WHERE status IN ('QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW')
             AND transaction_hash IS NULL
             AND last_error_code IS DISTINCT FROM 'MINT_SUBMISSION_RESPONSE_LOST'
             AND NOT EXISTS (
               SELECT 1 FROM outbox_events AS outbox
               WHERE outbox.aggregate_id = mint_jobs.id
                 AND outbox.status = 'LEASED'
                 AND outbox.lease_expires_at > $2
             )
         )::integer AS cancelled_mint_jobs,
         count(*) FILTER (
           WHERE status NOT IN ('FINALIZED', 'CANCELLED')
             AND (
               transaction_hash IS NOT NULL
               OR last_error_code = 'MINT_SUBMISSION_RESPONSE_LOST'
               OR EXISTS (
                 SELECT 1 FROM outbox_events AS outbox
                 WHERE outbox.aggregate_id = mint_jobs.id
                   AND outbox.status = 'LEASED'
                   AND outbox.lease_expires_at > $2
               )
             )
         )::integer AS pending_mint_jobs,
         count(*) FILTER (WHERE status = 'FINALIZED')::integer AS retained_finalized_nfts
       FROM mint_jobs
       WHERE account_id = $1`,
      [accountId, now],
    )
  ).rows[0]!;
  return {
    cancelledMintJobs: row.cancelled_mint_jobs,
    pendingMintJobs: row.pending_mint_jobs,
    retainedFinalizedNfts: row.retained_finalized_nfts,
  };
}

async function cancelUnsentMintJobs(
  client: PoolClient,
  accountId: string,
  now: Date,
): Promise<void> {
  const cancelled = await client.query<{ entitlement_id: string }>(
    `UPDATE mint_jobs
     SET status = 'CANCELLED', last_error_code = 'ACCOUNT_DELETION', updated_at = $1
     WHERE account_id = $2
       AND status IN ('QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW')
       AND transaction_hash IS NULL
       AND last_error_code IS DISTINCT FROM 'MINT_SUBMISSION_RESPONSE_LOST'
       AND NOT EXISTS (
         SELECT 1 FROM outbox_events AS outbox
         WHERE outbox.aggregate_id = mint_jobs.id
           AND outbox.status = 'LEASED'
           AND outbox.lease_expires_at > $1
       )
     RETURNING entitlement_id`,
    [now, accountId],
  );
  const entitlementIds = cancelled.rows.map((row) => row.entitlement_id);
  if (entitlementIds.length === 0) return;
  await client.query(
    `UPDATE reward_entitlements
     SET status = 'CANCELED', updated_at = $1
     WHERE id = ANY($2::uuid[])`,
    [now, entitlementIds],
  );
  await client.query(
    `UPDATE outbox_events
     SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE aggregate_id IN (
       SELECT id FROM mint_jobs WHERE entitlement_id = ANY($2::uuid[])
     )`,
    [now, entitlementIds],
  );
}

async function pseudonymizeAccount(
  client: PoolClient,
  accountId: string,
  deletedAlias: string,
  now: Date,
): Promise<void> {
  await client.query('DELETE FROM wallet_challenges WHERE account_id = $1', [accountId]);
  // Sessions keep the real account id so a leaked token still fails the revocation check.
  await client.query(
    `UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, $1) WHERE account_id = $2`,
    [now, accountId],
  );
  await client.query(
    `UPDATE web_sessions SET revoked_at = coalesce(revoked_at, $1) WHERE account_id = $2`,
    [now, accountId],
  );
  await client.query('DELETE FROM auth_identities WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM account_deletion_intake_requests WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM platform_admins WHERE account_id = $1', [accountId]);
  await client.query(
    'UPDATE platform_admin_role_audit SET target_account_id = $1 WHERE target_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE platform_admin_audit SET actor_account_id = $1 WHERE actor_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    `DELETE FROM customer_identity_tokens
     WHERE customer_account_id = $1 OR bound_staff_account_id = $1`,
    [accountId],
  );
  await client.query(
    `INSERT INTO merchant_members (
       merchant_id, account_id, role, status, granted_at, revoked_at, updated_at
     )
     SELECT merchant_id, $1, role, 'REVOKED', granted_at, $2, $2
     FROM merchant_members
     WHERE account_id = $3
     ON CONFLICT (merchant_id, account_id)
     DO UPDATE SET status = 'REVOKED', revoked_at = $2, updated_at = $2`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE claim_slots SET created_by_account_id = $1, updated_at = $2
     WHERE created_by_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query('DELETE FROM merchant_members WHERE account_id = $1', [accountId]);
  await client.query(
    `UPDATE claim_slots SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE visit_events SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE reward_entitlements SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  // Enrollment rows are re-aliased, not deleted; the campaign slot they reserved is not
  // returned so enrolled_count never exceeds the promised enrollment_capacity.
  await client.query(
    `UPDATE campaign_enrollments SET account_id = $1
     WHERE account_id = $2`,
    [deletedAlias, accountId],
  );
  await client.query(
    `UPDATE wallet_bindings
     SET account_id = $1, status = 'DISCONNECTED', disconnected_at = coalesce(disconnected_at, $2),
         updated_at = $2
     WHERE account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE mint_jobs SET account_id = $1, updated_at = $2
     WHERE account_id = $3`,
    [deletedAlias, now, accountId],
  );
}

async function findRequest(
  client: PoolClient,
  referenceHash: Buffer,
): Promise<RequestRow | undefined> {
  return (
    await client.query<RequestRow>(
      `SELECT id, deleted_account_alias, status, cancelled_mint_jobs,
              pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at
       FROM account_deletion_requests
       WHERE account_reference_hash = $1
       FOR UPDATE`,
      [referenceHash],
    )
  ).rows[0];
}

async function reconcileExistingRequest(
  client: PoolClient,
  request: RequestRow,
  now: Date,
): Promise<RequestRow> {
  if (request.status === 'COMPLETED') return request;
  const counts = (
    await client.query<{ pending: number; finalized: number }>(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('FINALIZED', 'CANCELLED'))::integer AS pending,
         count(*) FILTER (WHERE status = 'FINALIZED')::integer AS finalized
       FROM mint_jobs
       WHERE account_id = $1`,
      [request.deleted_account_alias],
    )
  ).rows[0]!;
  const status: AccountDeletionStatus = counts.pending > 0
    ? 'WAITING_FOR_MINT_FINALITY'
    : 'COMPLETED';
  return (
    await client.query<RequestRow>(
      `UPDATE account_deletion_requests
       SET status = $1, pending_mint_jobs = $2, retained_finalized_nfts = $3,
           completed_at = CASE WHEN $1 = 'COMPLETED' THEN $4::timestamptz ELSE NULL END,
           updated_at = $4
       WHERE id = $5
       RETURNING id, deleted_account_alias, status, cancelled_mint_jobs,
                 pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at`,
      [status, counts.pending, counts.finalized, now, request.id],
    )
  ).rows[0]!;
}

function mapResult(row: RequestRow, replayed: boolean): AccountDeletionResult {
  return {
    requestId: row.id,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    cancelledMintJobs: row.cancelled_mint_jobs,
    pendingMintJobs: row.pending_mint_jobs,
    retainedFinalizedNfts: row.retained_finalized_nfts,
    replayed,
  };
}
