import type { Pool } from 'pg';

import {
  AccountDeletionIntakeError,
  type AccountDeletionIntakeService,
  type DeletionIntakeReceipt,
  type DeletionIntakeSource,
  type DeletionIntakeStatus,
  type DeletionIntakeStatusView,
  type DeletionLedgerStatus,
} from '../account-deletion-intake.js';
import { generateReceipt, receiptHash } from '../deletion-receipt.js';
import { WebSessionError } from '../web-session.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

// D-052: a 24 hour cancellation window after filing, then operator processing within 7 days.
export const cancelWindowMs = 24 * 60 * 60 * 1000;
export const processingWindowMs = 7 * 24 * 60 * 60 * 1000;

type ServiceOptions = { source?: DeletionIntakeSource; now?: () => Date };

type StatusRow = {
  status: DeletionIntakeStatus;
  requested_at: Date;
  cancel_until: Date;
  due_at: Date;
  cancelled_at: Date | null;
  processed_at: Date | null;
  reject_reason: string | null;
  ledger_status: DeletionLedgerStatus | null;
  ledger_completed_at: Date | null;
};

const statusColumns = `
  intake.status, intake.requested_at, intake.cancel_until, intake.due_at, intake.cancelled_at,
  intake.processed_at, intake.reject_reason,
  ledger.status AS ledger_status, ledger.completed_at AS ledger_completed_at`;
const statusFrom = `
  FROM account_deletion_intake_requests AS intake
  LEFT JOIN account_deletion_requests AS ledger ON ledger.id = intake.deletion_request_id`;

export class PostgresAccountDeletionIntakeService implements AccountDeletionIntakeService {
  private readonly lifecycle: PostgresAccountLifecycle;
  private readonly source: DeletionIntakeSource;
  private readonly now: () => Date;

  constructor(private readonly pool: Pool, private readonly hmacSecret: string, options: ServiceOptions = {}) {
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret });
    this.source = options.source ?? 'WEB';
    this.now = options.now ?? (() => new Date());
  }

  async request(accountId: string, options: { reissue?: boolean } = {}): Promise<DeletionIntakeReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The per-account advisory lock also serializes this filing against a concurrent deletion of the same account.
      await this.lifecycle.assertActive(client, accountId);
      const identity = await client.query(
        `SELECT 1 FROM auth_identities WHERE provider = 'google' AND account_id = $1`,
        [accountId],
      );
      if (identity.rowCount !== 1) throw new WebSessionError('WEB_SESSION_INVALID');
      const existing = (await client.query<{
        id: string; receipt_hash: Buffer | null; requested_at: Date; cancel_until: Date; due_at: Date;
      }>(
        `SELECT id, receipt_hash, requested_at, cancel_until, due_at
         FROM account_deletion_intake_requests WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      )).rows[0];
      let result: DeletionIntakeReceipt;
      if (existing) {
        const dates = {
          status: 'REQUESTED' as const,
          requestedAt: existing.requested_at.toISOString(),
          cancelUntil: existing.cancel_until.toISOString(),
          dueAt: existing.due_at.toISOString(),
        };
        if (existing.receipt_hash !== null && !options.reissue) {
          result = { receiptIssued: false, ...dates };
        } else {
          // Rows from before receipts existed have none; a deliberate re-issue replaces a lost one. Both need the verified session.
          const receipt = generateReceipt();
          if (existing.receipt_hash === null) {
            // A legacy filing was made under the old promise of a further identity check and nobody could look it up. The
            // person filing again now gets the same windows as a new filing, counted from now, so the 24 hour cancellation
            // is real and the 7 day deadline is one they were told about.
            const now = this.now();
            const cancelUntil = new Date(now.getTime() + cancelWindowMs);
            const dueAt = new Date(now.getTime() + processingWindowMs);
            await client.query(
              `UPDATE account_deletion_intake_requests SET receipt_hash = $2, cancel_until = $3, due_at = $4 WHERE id = $1`,
              [existing.id, receiptHash(this.hmacSecret, receipt), cancelUntil, dueAt]);
            result = { receipt, receiptIssued: true, ...dates, cancelUntil: cancelUntil.toISOString(), dueAt: dueAt.toISOString() };
          } else {
            await client.query('UPDATE account_deletion_intake_requests SET receipt_hash = $2 WHERE id = $1',
              [existing.id, receiptHash(this.hmacSecret, receipt)]);
            result = { receipt, receiptIssued: true, ...dates };
          }
        }
      } else {
        // A re-issue only replaces the receipt of a filing the person already made; it never starts one.
        if (options.reissue) throw new AccountDeletionIntakeError('DELETION_NO_ACTIVE_REQUEST');
        const requestedAt = this.now();
        const cancelUntil = new Date(requestedAt.getTime() + cancelWindowMs);
        const dueAt = new Date(requestedAt.getTime() + processingWindowMs);
        const receipt = generateReceipt();
        await client.query(
          `INSERT INTO account_deletion_intake_requests (
             account_id, receipt_hash, status, source, requested_at, cancel_until, due_at
           ) VALUES ($1, $2, 'REQUESTED', $3, $4, $5, $6)`,
          [accountId, receiptHash(this.hmacSecret, receipt), this.source, requestedAt, cancelUntil, dueAt],
        );
        result = {
          receipt, receiptIssued: true, status: 'REQUESTED',
          requestedAt: requestedAt.toISOString(), cancelUntil: cancelUntil.toISOString(), dueAt: dueAt.toISOString(),
        };
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new WebSessionError('WEB_SESSION_INVALID');
      throw error;
    } finally {
      client.release();
    }
  }

  async current(accountId: string): Promise<DeletionIntakeStatusView | null> {
    const row = (await this.pool.query<StatusRow>(
      `SELECT ${statusColumns} ${statusFrom} WHERE intake.account_id = $1`, [accountId],
    )).rows[0];
    return row ? statusView(row, this.now()) : null;
  }

  async cancel(accountId: string): Promise<{ status: 'CANCELLED' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lifecycle.assertActive(client, accountId);
      const row = (await client.query<{ id: string; cancel_until: Date }>(
        `SELECT id, cancel_until FROM account_deletion_intake_requests WHERE account_id = $1 FOR UPDATE`,
        [accountId],
      )).rows[0];
      if (!row) throw new AccountDeletionIntakeError('DELETION_NO_ACTIVE_REQUEST');
      // The clock is read only after the row lock: processing is refused until this same instant has passed,
      // so a cancel and a process racing at the boundary cannot both succeed.
      const now = this.now();
      if (now.getTime() > row.cancel_until.getTime()) {
        throw new AccountDeletionIntakeError('DELETION_CANCEL_WINDOW_CLOSED');
      }
      await client.query(
        `UPDATE account_deletion_intake_requests
         SET status = 'CANCELLED', account_id = NULL, cancelled_at = $2
         WHERE id = $1`,
        [row.id, now],
      );
      await client.query('COMMIT');
      return { status: 'CANCELLED' };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new WebSessionError('WEB_SESSION_INVALID');
      throw error;
    } finally {
      client.release();
    }
  }

  async status(receipt: string): Promise<DeletionIntakeStatusView> {
    const row = (await this.pool.query<StatusRow>(
      `SELECT ${statusColumns} ${statusFrom} WHERE intake.receipt_hash = $1`,
      [receiptHash(this.hmacSecret, receipt)],
    )).rows[0];
    if (!row) throw new AccountDeletionIntakeError('DELETION_RECEIPT_NOT_FOUND');
    return statusView(row, this.now());
  }
}

function statusView(row: StatusRow, now: Date): DeletionIntakeStatusView {
  return {
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    cancelUntil: row.cancel_until.toISOString(),
    dueAt: row.due_at.toISOString(),
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    processedAt: row.processed_at?.toISOString() ?? null,
    rejectReason: row.reject_reason,
    overdue: row.status === 'REQUESTED' && now.getTime() > row.due_at.getTime(),
    deletion: row.ledger_status === null ? null : {
      status: row.ledger_status,
      completedAt: row.ledger_completed_at?.toISOString() ?? null,
    },
  };
}
