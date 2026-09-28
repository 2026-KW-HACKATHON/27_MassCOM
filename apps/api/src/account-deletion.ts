export type AccountDeletionStatus = 'WAITING_FOR_MINT_FINALITY' | 'COMPLETED';

export type AccountDeletionResult = {
  requestId: string;
  status: AccountDeletionStatus;
  requestedAt: string;
  completedAt: string | null;
  cancelledMintJobs: number;
  pendingMintJobs: number;
  retainedFinalizedNfts: number;
  replayed: boolean;
};

export interface AccountDeletionService {
  requestDeletion(input: {
    accountId: string;
    confirmation: string;
    sessionToken?: string;
  }): Promise<AccountDeletionResult>;
}

export class AccountDeletionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AccountDeletionError';
  }
}
