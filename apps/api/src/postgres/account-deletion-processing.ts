import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  AccountDeletionIntakeError,
  type AccountDeletionProcessingService,
  type AdminDeletionIntake,
  type DeletionIntakeSource,
  type DeletionIntakeStatus,
  type DeletionLedgerStatus,
  type DeletionOperator,
} from '../account-deletion-intake.js';
import { rejectReasonLooksPersonal } from '../deletion-reject-reason.js';
import { safeErrorMetadata } from '../security-log.js';
import { PostgresAccountDeletionService, markIntakeProcessed, reconcileWaitingRequests } from './account-deletion.js';
import { PostgresAccountLifecycle } from './account-lifecycle.js';
import { assertPlatformAdmin } from './admin.js';

/** An operator attempt the service refused. Tests observe it here; without a sink it goes to the log as a safe metadata line. */
export type DeletionRefusal = {
  action: 'process' | 'reject';
  code: 'DELETION_SELF_PROCESSING_REFUSED' | 'DELETION_COOLING_OFF' | 'DELETION_LEGACY_NEEDS_REFILE';
};

type Options = {
  hmacSecret: string;
  policyVersion: string;
  now?: () => Date;
  nextRequestId?: () => string;
  onRefusal?: (refusal: DeletionRefusal) => void;
};

const loggedRefusals: ReadonlySet<string> = new Set<DeletionRefusal['code']>([
  'DELETION_SELF_PROCESSING_REFUSED', 'DELETION_COOLING_OFF', 'DELETION_LEGACY_NEEDS_REFILE',
]);

type IntakeRow = {
  id: string;
  status: DeletionIntakeStatus;
  source: DeletionIntakeSource;
  requested_at: Date;
  cancel_until: Date;
  due_at: Date;
  account_id: string | null;
  has_receipt: boolean;
  processed_at: Date | null;
  processed_by: string | null;
  reject_reason: string | null;
  ledger_status: DeletionLedgerStatus | null;
  ledger_completed_at: Date | null;
};

const intakeColumns = `
  intake.id, intake.status, intake.source, intake.requested_at, intake.cancel_until, intake.due_at,
  intake.account_id, intake.receipt_hash IS NOT NULL AS has_receipt, intake.processed_at, intake.processed_by,
  intake.reject_reason,
  ledger.status AS ledger_status, ledger.completed_at AS ledger_completed_at`;
const intakeFrom = `
  FROM account_deletion_intake_requests AS intake
  LEFT JOIN account_deletion_requests AS ledger ON ledger.id = intake.deletion_request_id`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const operatorPattern = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Operator processing of a web-OIDC-verified filing (#194, D-052). This is a different path from D-026's direct
 * automatic deletion: nothing here weakens the 5-minute `auth_time` rule, which still guards `requestDeletion`.
 */
export class PostgresAccountDeletionProcessingService implements AccountDeletionProcessingService {
  private readonly lifecycle: PostgresAccountLifecycle;
  private readonly deletion: PostgresAccountDeletionService;
  private readonly now: () => Date;
  private readonly onRefusal: ((refusal: DeletionRefusal) => void) | undefined;

  constructor(private readonly pool: Pool, options: Options) {
    this.now = options.now ?? (() => new Date());
    this.onRefusal = options.onRefusal;
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret: options.hmacSecret });
    this.deletion = new PostgresAccountDeletionService(pool, {
      hmacSecret: options.hmacSecret,
      policyVersion: options.policyVersion,
      accountLifecycle: this.lifecycle,
      now: this.now,
      ...(options.nextRequestId ? { nextRequestId: options.nextRequestId } : {}),
    });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // Locks are taken in one order (see lockOperatorAndTarget), so this should not happen; if it ever does, the operator
      // is told to retry instead of seeing a database error.
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '40P01') {
        throw new AccountDeletionIntakeError('DELETION_BUSY');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The refused-attempt trail: a refusal rolls back its transaction, so it is logged here, outside it. The line is the
   * event name and the refusal code only (the privacy log scan admits nothing else from this layer), so it carries no
   * account ID, filing ID or operator name.
   */
  private async refusalLogged<T>(action: DeletionRefusal['action'], run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AccountDeletionIntakeError && loggedRefusals.has(error.code)) {
        if (this.onRefusal) this.onRefusal({ action, code: error.code as DeletionRefusal['code'] });
        else if (action === 'process') console.warn(safeErrorMetadata('account_deletion.process_refused', error, loggedRefusals));
        else console.warn(safeErrorMetadata('account_deletion.reject_refused', error, loggedRefusals));
      }
      throw error;
    }
  }

  private async authorize(client: PoolClient, operator: DeletionOperator): Promise<void> {
    if (operator.kind === 'admin') {
      await assertPlatformAdmin(client, this.lifecycle, operator.accountId);
    } else if (!operatorPattern.test(operator.operator)) {
      throw new Error('DELETION_OPERATOR_INVALID');
    }
  }

  async list(operator: DeletionOperator): Promise<AdminDeletionIntake[]> {
    return this.transaction(async (client) => {
      await this.authorize(client, operator);
      const now = this.now();
      const rows = (await client.query<IntakeRow>(
        `SELECT ${intakeColumns} ${intakeFrom}
         ORDER BY (intake.status = 'REQUESTED') DESC,
                  CASE WHEN intake.status = 'REQUESTED' THEN intake.due_at END ASC,
                  coalesce(intake.processed_at, intake.cancelled_at, intake.requested_at) DESC,
                  intake.id
         LIMIT 100`,
      )).rows;
      return rows.map((row) => adminIntake(row, now));
    });
  }

  async process(operator: DeletionOperator, intakeId: string): Promise<AdminDeletionIntake> {
    return this.refusalLogged('process', () => this.transaction(async (client) => {
      await this.lockOperatorAndTarget(client, operator, intakeId);
      await this.authorize(client, operator);
      const pending = await this.lockPending(client, operator, intakeId);
      const now = this.now();
      if (now.getTime() <= pending.cancel_until.getTime()) {
        throw new AccountDeletionIntakeError('DELETION_COOLING_OFF');
      }
      // A filing with no receipt predates receipts; its filer was told a further identity check would come, and nobody could
      // look it up. It is processed only after the person files again (which issues a receipt and restarts the windows).
      if (!pending.has_receipt) throw new AccountDeletionIntakeError('DELETION_LEGACY_NEEDS_REFILE');
      const { row: ledger } = await this.deletion.forgetInTransaction(client, pending.account_id, now);
      await markIntakeProcessed(client, pending.account_id, ledger.id, now, processedBy(operator));
      const after = await this.load(client, intakeId, now);
      await this.audit(client, operator, 'ACCOUNT_DELETION_PROCESSED',
        { intakeId, source: pending.source, status: 'REQUESTED' },
        { intakeId, source: pending.source, status: 'PROCESSED', ledgerStatus: ledger.status });
      return after;
    }));
  }

  async reject(operator: DeletionOperator, intakeId: string, reason: string): Promise<AdminDeletionIntake> {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    // eslint-disable-next-line no-control-regex
    if (trimmed.length < 1 || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed) ||
        rejectReasonLooksPersonal(trimmed)) {
      throw new AccountDeletionIntakeError('DELETION_REJECT_REASON_INVALID');
    }
    return this.refusalLogged('reject', () => this.transaction(async (client) => {
      await this.lockOperatorAndTarget(client, operator, intakeId);
      await this.authorize(client, operator);
      const pending = await this.lockPending(client, operator, intakeId);
      const now = this.now();
      await client.query(
        `UPDATE account_deletion_intake_requests
         SET status = 'REJECTED', account_id = NULL, processed_at = $2, processed_by = $3, reject_reason = $4
         WHERE id = $1`,
        [intakeId, now, processedBy(operator), trimmed],
      );
      const after = await this.load(client, intakeId, now);
      await this.audit(client, operator, 'ACCOUNT_DELETION_REJECTED',
        { intakeId, source: pending.source, status: 'REQUESTED' },
        { intakeId, source: pending.source, status: 'REJECTED', reason: trimmed });
      return after;
    }));
  }

  async reconcile(operator: DeletionOperator): Promise<{ checked: number; completed: number; waiting: number }> {
    return this.transaction(async (client) => {
      await this.authorize(client, operator);
      const result = await reconcileWaitingRequests(client, this.now());
      if (result.completed > 0) {
        await this.audit(client, operator, 'ACCOUNT_DELETION_RECONCILED', null,
          { checked: result.checked, completed: result.completed });
      }
      return result;
    });
  }

  /**
   * An administrator holds their own account's lock (to be checked as an administrator) and then the target's. Two
   * administrators acting on each other's filings would each hold one and wait for the other, so both locks are taken
   * first, in the one sorted order every account lock uses. The filing is peeked at without a lock; `lockPending`
   * re-reads it under the locks. The CLI operator has no account and needs only the target's lock, taken there.
   */
  private async lockOperatorAndTarget(client: PoolClient, operator: DeletionOperator, intakeId: string): Promise<void> {
    if (operator.kind !== 'admin' || !uuidPattern.test(intakeId)) return;
    const target = (await client.query<{ account_id: string | null }>(
      'SELECT account_id FROM account_deletion_intake_requests WHERE id = $1', [intakeId],
    )).rows[0]?.account_id;
    await this.lifecycle.lockAllForDeletion(client, target ? [operator.accountId, target] : [operator.accountId]);
  }

  /**
   * Finds the filing, refuses an operator acting on their own, then takes the same locks as filing and cancelling
   * (account advisory lock, then the row) so the three cannot interleave.
   */
  private async lockPending(
    client: PoolClient,
    operator: DeletionOperator,
    intakeId: string,
  ): Promise<{ account_id: string; source: DeletionIntakeSource; cancel_until: Date; has_receipt: boolean }> {
    if (!uuidPattern.test(intakeId)) throw new AccountDeletionIntakeError('DELETION_INTAKE_NOT_FOUND');
    const peek = (await client.query<{ account_id: string | null; status: DeletionIntakeStatus }>(
      'SELECT account_id, status FROM account_deletion_intake_requests WHERE id = $1', [intakeId],
    )).rows[0];
    if (!peek) throw new AccountDeletionIntakeError('DELETION_INTAKE_NOT_FOUND');
    if (peek.status !== 'REQUESTED' || peek.account_id === null) {
      throw new AccountDeletionIntakeError('DELETION_INTAKE_NOT_PENDING');
    }
    if (operator.kind === 'admin' && operator.accountId === peek.account_id) {
      throw new AccountDeletionIntakeError('DELETION_SELF_PROCESSING_REFUSED');
    }
    await this.lifecycle.lockForDeletion(client, peek.account_id);
    const row = (await client.query<{
      account_id: string | null; status: DeletionIntakeStatus; source: DeletionIntakeSource; cancel_until: Date;
      has_receipt: boolean;
    }>(
      `SELECT account_id, status, source, cancel_until, receipt_hash IS NOT NULL AS has_receipt
       FROM account_deletion_intake_requests WHERE id = $1 FOR UPDATE`, [intakeId],
    )).rows[0];
    if (!row || row.status !== 'REQUESTED' || row.account_id !== peek.account_id) {
      throw new AccountDeletionIntakeError('DELETION_INTAKE_NOT_PENDING');
    }
    return { account_id: row.account_id, source: row.source, cancel_until: row.cancel_until, has_receipt: row.has_receipt };
  }

  private async load(client: PoolClient, intakeId: string, now: Date): Promise<AdminDeletionIntake> {
    const row = (await client.query<IntakeRow>(
      `SELECT ${intakeColumns} ${intakeFrom} WHERE intake.id = $1`, [intakeId],
    )).rows[0]!;
    return adminIntake(row, now);
  }

  private async audit(
    client: PoolClient,
    operator: DeletionOperator,
    action: 'ACCOUNT_DELETION_PROCESSED' | 'ACCOUNT_DELETION_REJECTED' | 'ACCOUNT_DELETION_RECONCILED',
    before: object | null,
    after: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
       VALUES ($1, $2, NULL, $3, $4, $5)`,
      [
        randomUUID(),
        operator.kind === 'admin' ? operator.accountId : `cli:${operator.operator}`,
        action,
        before ? JSON.stringify(before) : null,
        JSON.stringify(after),
      ],
    );
  }
}

// The intake row never stores an admin's account ID (that would outlive the admin's own deletion); the audit row does.
function processedBy(operator: DeletionOperator): string {
  return operator.kind === 'admin' ? 'admin-web' : `cli:${operator.operator}`;
}

function maskAccountId(accountId: string): string {
  const prefix = accountId.startsWith('acct_') ? 'acct_' : '';
  const body = accountId.slice(prefix.length);
  return body.length < 12 ? `${prefix}…${body.slice(-2)}` : `${prefix}${body.slice(0, 4)}…${body.slice(-4)}`;
}

function adminIntake(row: IntakeRow, now: Date): AdminDeletionIntake {
  const requested = row.status === 'REQUESTED';
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    requestedAt: row.requested_at.toISOString(),
    cancelUntil: row.cancel_until.toISOString(),
    dueAt: row.due_at.toISOString(),
    // A filing with no receipt is never processable: its filer must file again first.
    canProcess: requested && row.has_receipt && now.getTime() > row.cancel_until.getTime(),
    overdue: requested && now.getTime() > row.due_at.getTime(),
    accountLabel: row.account_id === null ? null : maskAccountId(row.account_id),
    hasReceipt: row.has_receipt,
    processedAt: row.processed_at?.toISOString() ?? null,
    processedBy: row.processed_by,
    rejectReason: row.reject_reason,
    deletion: row.ledger_status === null ? null : {
      status: row.ledger_status,
      completedAt: row.ledger_completed_at?.toISOString() ?? null,
    },
  };
}
