export type MintWorkItem = {
  jobId: string;
  outboxId: string;
  accountId: string;
  entitlementId: string;
  rewardKey: string;
  recipient: string;
  chainId: number;
  contractAddress: string;
  seriesKey: string;
  transactionHash?: string;
};

export type ChainMintResult = {
  transactionHash: string;
  blockNumber: number;
  blockHash: string;
  logIndex: number;
  tokenId: string;
  rewardKey: string;
  recipient: string;
  seriesKey: string;
  contractAddress: string;
  chainId: number;
};

export interface MintWorkRepository {
  leaseNext(workerId: string, leaseMs: number): Promise<MintWorkItem | undefined>;
  markPrepared(item: MintWorkItem, workerId: string): Promise<string>;
  markSubmitted(
    jobId: string,
    workerId: string,
    attemptId: string,
    transactionHash: string,
  ): Promise<void>;
  finalize(
    item: MintWorkItem,
    workerId: string,
    attemptId: string | undefined,
    result: ChainMintResult,
  ): Promise<void>;
  releaseRetryable(jobId: string, workerId: string, code: string): Promise<void>;
  markManualReview(jobId: string, workerId: string, code: string): Promise<void>;
}

export interface MintChainGateway {
  validate(item: MintWorkItem): Promise<void>;
  findMintByRewardKey(item: MintWorkItem): Promise<ChainMintResult | undefined>;
  submitMint(item: MintWorkItem): Promise<{ transactionHash: string }>;
  confirmMint(item: MintWorkItem, transactionHash: string): Promise<ChainMintResult>;
}

export class ChainConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ChainConfigurationError';
  }
}

export class SubmissionOutcomeUnknownError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SubmissionOutcomeUnknownError';
  }
}

export class MintEventMismatchError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MintEventMismatchError';
  }
}

export class RetryableChainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'RetryableChainError';
  }
}

export class MintWorker {
  constructor(
    private readonly repository: MintWorkRepository,
    private readonly gateway: MintChainGateway,
    private readonly leaseMs = 30_000,
  ) {}

  async runOnce(workerId: string): Promise<boolean> {
    const item = await this.repository.leaseNext(workerId, this.leaseMs);
    if (!item) return false;

    try {
      await this.gateway.validate(item);
    } catch (error) {
      await this.handleChainError(item, workerId, error);
      return true;
    }

    try {
      const existing = await this.gateway.findMintByRewardKey(item);
      if (existing) {
        await this.repository.finalize(item, workerId, undefined, existing);
        return true;
      }
    } catch (error) {
      await this.handleChainError(item, workerId, error);
      return true;
    }

    if (item.transactionHash) {
      try {
        const confirmed = await this.gateway.confirmMint(item, item.transactionHash);
        await this.repository.finalize(item, workerId, undefined, confirmed);
      } catch (error) {
        await this.handleChainError(item, workerId, error);
      }
      return true;
    }

    const attemptId = await this.repository.markPrepared(item, workerId);
    let transactionHash: string;
    try {
      transactionHash = (await this.gateway.submitMint(item)).transactionHash;
      await this.repository.markSubmitted(item.jobId, workerId, attemptId, transactionHash);
    } catch (error) {
      if (error instanceof SubmissionOutcomeUnknownError) {
        try {
          const recovered = await this.gateway.findMintByRewardKey(item);
          if (recovered) {
            await this.repository.finalize(item, workerId, attemptId, recovered);
            return true;
          }
        } catch (lookupError) {
          await this.handleChainError(item, workerId, lookupError);
          return true;
        }
      }
      await this.handleChainError(item, workerId, error);
      return true;
    }

    try {
      const confirmed = await this.gateway.confirmMint(item, transactionHash);
      await this.repository.finalize(item, workerId, attemptId, confirmed);
    } catch (error) {
      await this.handleChainError(item, workerId, error);
    }
    return true;
  }

  private async handleChainError(
    item: MintWorkItem,
    workerId: string,
    error: unknown,
  ): Promise<void> {
    if (error instanceof RetryableChainError || error instanceof SubmissionOutcomeUnknownError) {
      await this.repository.releaseRetryable(item.jobId, workerId, error.code);
      return;
    }
    if (error instanceof ChainConfigurationError || error instanceof MintEventMismatchError) {
      await this.repository.markManualReview(item.jobId, workerId, error.code);
      return;
    }
    await this.repository.releaseRetryable(item.jobId, workerId, 'UNEXPECTED_WORKER_ERROR');
  }
}
