export type DeletionIntakeSource = 'WEB' | 'SHOWCASE_APP';
export type DeletionIntakeStatus = 'REQUESTED' | 'CANCELLED' | 'PROCESSED' | 'REJECTED';
export type DeletionLedgerStatus = 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED';

/** What the requester learns when filing. `receipt` appears only when a new one was issued. */
export type DeletionIntakeReceipt = {
  receipt?: string;
  receiptIssued: boolean;
  status: 'REQUESTED';
  requestedAt: string;
  cancelUntil: string;
  dueAt: string;
};

/** The requester-visible state. It never carries an account ID, an email or any operator identity. */
export type DeletionIntakeStatusView = {
  status: DeletionIntakeStatus;
  requestedAt: string;
  cancelUntil: string;
  dueAt: string;
  cancelledAt: string | null;
  processedAt: string | null;
  rejectReason: string | null;
  deletion: {
    status: DeletionLedgerStatus;
    completedAt: string | null;
    pendingMintJobs: number;
    retainedFinalizedNfts: number;
  } | null;
};

export interface AccountDeletionIntakeService {
  /** `reissue` replaces the receipt of the caller's own active request; a repeat filing otherwise returns no receipt. */
  request(accountId: string, options?: { reissue?: boolean }): Promise<DeletionIntakeReceipt>;
  /** The caller's own active request, without a receipt. */
  current(accountId: string): Promise<DeletionIntakeStatusView | null>;
  cancel(accountId: string): Promise<{ status: 'CANCELLED' }>;
  /** Lookup by receipt alone, for people whose account and sessions are already gone. */
  status(receipt: string): Promise<DeletionIntakeStatusView>;
}

export type AdminDeletionIntake = {
  id: string;
  status: DeletionIntakeStatus;
  source: DeletionIntakeSource;
  requestedAt: string;
  cancelUntil: string;
  dueAt: string;
  /** Requested and past the cancellation window: the operator may process it now. */
  canProcess: boolean;
  overdue: boolean;
  /** First four and last four characters of the account ID; null once the account is gone. */
  accountLabel: string | null;
  processedAt: string | null;
  processedBy: string | null;
  rejectReason: string | null;
  deletion: { status: DeletionLedgerStatus; completedAt: string | null } | null;
};

/** Who is acting. An admin is a verified platform admin; the CLI is the showcase operator on the host. */
export type DeletionOperator =
  | { kind: 'admin'; accountId: string }
  | { kind: 'cli'; operator: string };

export interface AccountDeletionProcessingService {
  list(operator: DeletionOperator): Promise<AdminDeletionIntake[]>;
  process(operator: DeletionOperator, intakeId: string): Promise<AdminDeletionIntake>;
  reject(operator: DeletionOperator, intakeId: string, reason: string): Promise<AdminDeletionIntake>;
  reconcile(operator: DeletionOperator): Promise<{ checked: number; completed: number; waiting: number }>;
}

export type AccountDeletionIntakeErrorCode =
  | 'DELETION_NO_ACTIVE_REQUEST'
  | 'DELETION_CANCEL_WINDOW_CLOSED'
  | 'DELETION_RECEIPT_NOT_FOUND'
  | 'DELETION_INTAKE_NOT_FOUND'
  | 'DELETION_INTAKE_NOT_PENDING'
  | 'DELETION_COOLING_OFF'
  | 'DELETION_SELF_PROCESSING_REFUSED'
  | 'DELETION_REJECT_REASON_INVALID';

export class AccountDeletionIntakeError extends Error {
  constructor(readonly code: AccountDeletionIntakeErrorCode) {
    super(code);
    this.name = 'AccountDeletionIntakeError';
  }
}
