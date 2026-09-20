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
  /**
   * The signed raw transaction recorded for `transactionHash` before it was broadcast (service
   * signer only). Present when a restart needs to re-broadcast the exact same signed transaction
   * rather than build a new one.
   */
  signedTransaction?: string;
};

/** What the gateway persists through the worker before it broadcasts a signed transaction. */
export type RecordedSubmission = {
  transactionHash: string;
  signedTransaction?: string;
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
    signedTransaction?: string,
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
  /**
   * Serializes a block of work (reading the minter's pending nonce, signing, recording, and
   * broadcasting) against every other worker process submitting for the same chain/minter pair,
   * using a PostgreSQL advisory lock. A gateway with no local signer (the local unlocked path)
   * never needs this, but every caller goes through it uniformly.
   */
  withMinterLock<T>(chainId: number, minterAddress: string, fn: () => Promise<T>): Promise<T>;
  listUnconfirmedSignedTransactions(
    chainId: number,
  ): Promise<{ transactionHash: string; signedTransaction: string }[]>;
}

export interface MintChainGateway {
  /** The address submissions are signed/sent from. Used as the nonce-serialization lock key. */
  readonly minterAddress: string;
  validate(item: MintWorkItem): Promise<void>;
  assertCanSubmit(item: MintWorkItem): Promise<void>;
  findMintByRewardKey(item: MintWorkItem): Promise<ChainMintResult | undefined>;
  /**
   * `persistBeforeBroadcast` is invoked with the transaction hash (and, for a locally signed
   * transaction, the signed raw transaction) once it is known but before anything is sent to the
   * network, so the caller can make it durable first. The local-unlocked path only learns the
   * hash once the node has already broadcast it, so it calls this right after, unchanged from
   * previous behaviour.
   * `unconfirmedSignedTransactions` is this chain's set of recorded-but-not-yet-confirmed signed
   * attempts (the same set the caller just swept via rebroadcastIfNeeded): a service-signer
   * gateway uses it as a floor under the nonce it reads from the network, in case the RPC's
   * pending-nonce view lags behind what this worker already knows it has sent. Ignored by the
   * local-unlocked path, which lets the node manage its own nonces.
   */
  submitMint(
    item: MintWorkItem,
    persistBeforeBroadcast: (record: RecordedSubmission) => Promise<void>,
    unconfirmedSignedTransactions: { transactionHash: string; signedTransaction: string }[],
  ): Promise<{ transactionHash: string }>;
  /**
   * Restart recovery for a job that already has a recorded-but-possibly-unbroadcast signed
   * transaction: broadcasts it again if the network does not already know it. A no-op for the
   * local-unlocked path, which never records before broadcasting.
   */
  rebroadcastIfNeeded(transactionHash: string, signedTransaction: string): Promise<void>;
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
          if (item.signedTransaction) {
            // Never build a new transaction for a job that already holds a hash: re-broadcast
            // the exact same signed transaction if the network has not seen it yet (a crash or a
            // lost response between recording and broadcasting), then confirm as usual.
            await this.gateway.rebroadcastIfNeeded(transactionHash, item.signedTransaction);
          }
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

      let transactionHash: string;
      let attemptId: string;
      // Set as soon as markPrepared succeeds inside the lock below, so a later failure in that
      // same lock callback (e.g. submitMint reporting an unknown outcome) still knows which
      // attempt row this submission belongs to, even though the callback itself never returned.
      let preparedAttemptId: string | undefined;
      try {
        // One minter can serve many jobs across several worker processes: hold the per
        // chain/minter advisory lock for the whole sweep -> markPrepared -> nonce-read -> sign ->
        // record -> broadcast sequence so two submissions never race for the same nonce, and so
        // a straggler this job cannot get past is discovered before this job's own attempt is
        // consumed.
        const outcome = await this.repository.withMinterLock(
          item.chainId,
          this.gateway.minterAddress,
          async (): Promise<
            { blocked: true } | { blocked: false; attemptId: string; transactionHash: string }
          > => {
            // A transaction recorded by a worker that died before broadcasting still owns its
            // nonce. Send those first, or this submission reads the same pending nonce and the
            // recorded one can never be mined. This runs before markPrepared: if a straggler
            // cannot be gotten past, this job's attempt must not be spent on someone else's
            // stuck transaction.
            let unconfirmedSignedTransactions: { transactionHash: string; signedTransaction: string }[];
            try {
              unconfirmedSignedTransactions = await this.repository.listUnconfirmedSignedTransactions(
                item.chainId,
              );
            } catch (error) {
              if (error instanceof RetryableChainError) return { blocked: true };
              throw error;
            }
            for (const pending of unconfirmedSignedTransactions) {
              try {
                await this.gateway.rebroadcastIfNeeded(pending.transactionHash, pending.signedTransaction);
              } catch (error) {
                if (error instanceof RetryableChainError) {
                  // Every mint on this chain waits behind this transaction until its own job is
                  // settled or times out, so name it for the operator. The hash is public data.
                  console.error('mint worker: minter nonce blocked by an unbroadcastable transaction', {
                    transactionHash: pending.transactionHash,
                    code: error.code,
                  });
                  return { blocked: true };
                }
                throw error;
              }
            }
            preparedAttemptId = await this.repository.markPrepared(item, workerId);
            await heartbeat.assertHealthy();
            const submission = await this.gateway.submitMint(
              item,
              (record) =>
                this.repository.markSubmitted(
                  item.jobId,
                  workerId,
                  preparedAttemptId!,
                  record.transactionHash,
                  record.signedTransaction,
                ),
              unconfirmedSignedTransactions,
            );
            return {
              blocked: false,
              attemptId: preparedAttemptId,
              transactionHash: submission.transactionHash,
            };
          },
        );
        if (outcome.blocked) {
          // No attempt was consumed: nothing was prepared for this job. Release it for a fresh
          // try rather than letting an unrelated stuck straggler burn this job's retry budget.
          await this.repository.releaseRetryable(item.jobId, workerId, 'MINTER_NONCE_BLOCKED');
          return true;
        }
        attemptId = outcome.attemptId;
        transactionHash = outcome.transactionHash;
      } catch (error) {
        if (error instanceof SubmissionOutcomeUnknownError) {
          try {
            const recovered = await this.gateway.findMintByRewardKey(item);
            if (recovered) {
              await this.repository.finalize(item, workerId, preparedAttemptId, recovered);
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
      // A non-retryable recheck (e.g. a configuration error) must not vanish silently: it is
      // not the outcome acted on below, but it is worth a trace to explain why the transient
      // recheck did not save this job from manual review.
      console.error('mint worker: assertCanSubmit recheck failed', {
        name: (transientError as { name?: unknown })?.name,
        code: (transientError as { code?: unknown })?.code,
      });
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
