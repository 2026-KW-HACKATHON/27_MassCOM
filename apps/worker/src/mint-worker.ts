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
  renewLease(item: MintWorkItem, workerId: string, leaseMs: number): Promise<void>;
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
  /** Atomically drops a reverted submission and releases the job for retry. */
  releaseRevertedForRetry(
    jobId: string,
    workerId: string,
    attemptId: string,
    revertCode: string,
    retryCode: string,
  ): Promise<void>;
  /**
   * Finds the attempt that submitted the given transaction hash for a job, so a restart-recovery
   * path (which never called markPrepared this run) can still pass the right attempt id to
   * releaseRevertedForRetry.
   */
  findAttemptIdForTransactionHash(
    jobId: string,
    transactionHash: string,
  ): Promise<string | undefined>;
  markManualReview(jobId: string, workerId: string, code: string): Promise<void>;
}

export interface MintChainGateway {
  validate(item: MintWorkItem): Promise<void>;
  assertCanSubmit(item: MintWorkItem): Promise<void>;
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
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
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
    const heartbeat = this.startLeaseHeartbeat(item, workerId);

    try {
      try {
        await this.gateway.validate(item);
      } catch (error) {
        await this.handleChainError(item, workerId, error);
        return true;
      }
      await heartbeat.assertHealthy();

      try {
        const existing = await this.gateway.findMintByRewardKey(item);
        await heartbeat.assertHealthy();
        if (existing) {
          await this.repository.finalize(item, workerId, undefined, existing);
          return true;
        }
      } catch (error) {
        await this.handleChainError(item, workerId, error);
        return true;
      }

      if (item.transactionHash) {
        const transactionHash = item.transactionHash;
        try {
          const confirmed = await this.gateway.confirmMint(item, transactionHash);
          await this.repository.finalize(item, workerId, undefined, confirmed);
        } catch (error) {
          await this.handleConfirmError(
            item,
            workerId,
            undefined,
            transactionHash,
            heartbeat,
            error,
          );
        }
        return true;
      }

      try {
        await this.gateway.assertCanSubmit(item);
      } catch (error) {
        await this.handleChainError(item, workerId, error);
        return true;
      }

      const attemptId = await this.repository.markPrepared(item, workerId);
      await heartbeat.assertHealthy();
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
        await this.handleConfirmError(item, workerId, attemptId, transactionHash, heartbeat, error);
      }
      return true;
    } finally {
      await heartbeat.stop();
    }
  }

  private startLeaseHeartbeat(item: MintWorkItem, workerId: string): {
    assertHealthy: () => Promise<void>;
    stop: () => Promise<void>;
  } {
    const intervalMs = Math.max(10, Math.floor(this.leaseMs / 3));
    let pending = Promise.resolve();
    let failure: unknown;
    const renew = () => {
      pending = pending.then(async () => {
        try {
          await this.repository.renewLease(item, workerId, this.leaseMs);
        } catch (error) {
          failure ??= error;
        }
      });
    };
    const timer = setInterval(renew, intervalMs);
    timer.unref();
    const assertHealthy = async () => {
      renew();
      await pending;
      if (failure) throw failure;
    };
    return {
      assertHealthy,
      stop: async () => {
        clearInterval(timer);
        await assertHealthy();
      },
    };
  }

  /**
   * Single decision for what happens after confirmMint fails, shared by the restart-recovery path
   * (attemptId undefined, nothing prepared this run) and the fresh-submission path (attemptId set):
   * the same failure must give the same outcome either way.
   */
  private async handleConfirmError(
    item: MintWorkItem,
    workerId: string,
    attemptId: string | undefined,
    transactionHash: string,
    heartbeat: { assertHealthy: () => Promise<void>; stop: () => Promise<void> },
    error: unknown,
  ): Promise<void> {
    if (!(error instanceof MintEventMismatchError && error.code === 'MINT_TRANSACTION_REVERTED')) {
      await this.handleChainError(item, workerId, error);
      return;
    }
    try {
      const recovered = await this.gateway.findMintByRewardKey(item);
      await heartbeat.assertHealthy();
      if (recovered) {
        await this.repository.finalize(item, workerId, attemptId, recovered);
        return;
      }
    } catch (lookupError) {
      await this.handleChainError(item, workerId, lookupError);
      return;
    }
    // Not yet minted: before treating this as a permanent revert, recheck the transient
    // conditions (pause/balance/RPC) a race with assertCanSubmit could have caused. A
    // transient hit must drop the reverted hash in the same transaction that releases the
    // job: a leftover hash is re-confirmed forever, and a hash dropped without the release
    // leaves a SUBMITTED job nothing can pick up.
    try {
      await this.gateway.assertCanSubmit(item);
    } catch (transientError) {
      if (transientError instanceof RetryableChainError) {
        // The restart path never called markPrepared this run, so it has no attempt id: recover
        // the attempt that actually submitted the stored hash so the right row is marked FAILED.
        const resolvedAttemptId =
          attemptId ?? (await this.repository.findAttemptIdForTransactionHash(item.jobId, transactionHash));
        if (resolvedAttemptId) {
          await this.repository.releaseRevertedForRetry(
            item.jobId,
            workerId,
            resolvedAttemptId,
            error.code,
            transientError.code,
          );
          return;
        }
      }
    }
    await this.handleChainError(item, workerId, error);
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
