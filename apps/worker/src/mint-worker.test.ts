import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ChainConfigurationError,
  MintEventMismatchError,
  MintWorker,
  RetryableChainError,
  SubmissionOutcomeUnknownError,
  type ChainMintResult,
  type MintChainGateway,
  type MintWorkItem,
  type MintWorkRepository,
  type UnconfirmedSignedTransaction,
} from './mint-worker.js';

const work: MintWorkItem = {
  jobId: 'job-1',
  outboxId: 'outbox-1',
  accountId: 'customer-1',
  entitlementId: 'entitlement-1',
  rewardKey: `0x${'11'.repeat(32)}`,
  recipient: '0x4000000000000000000000000000000000000004',
  chainId: 31337,
  contractAddress: '0x7000000000000000000000000000000000000007',
  seriesKey: `0x${'33'.repeat(32)}`,
};

const result: ChainMintResult = {
  transactionHash: `0x${'aa'.repeat(32)}`,
  blockNumber: 4,
  blockHash: `0x${'bb'.repeat(32)}`,
  logIndex: 2,
  tokenId: '1',
  rewardKey: work.rewardKey,
  recipient: work.recipient,
  seriesKey: work.seriesKey,
  contractAddress: work.contractAddress,
  chainId: work.chainId,
};

function workCalls(repository: FakeRepository): string[] {
  return repository.calls.filter((call) => call !== 'renewed');
}

class FakeRepository implements MintWorkRepository {
  leased = false;
  calls: string[] = [];
  renewError?: Error;
  failRenewAt?: number;
  renewCount = 0;
  recoveredAttemptId?: string = 'attempt-recovered';

  async leaseNext(): Promise<MintWorkItem | undefined> {
    this.calls.push('lease');
    if (this.leased) return undefined;
    this.leased = true;
    return work;
  }

  async markPrepared(): Promise<string> {
    this.calls.push('prepared');
    return 'attempt-1';
  }

  async markSubmitted(
    _jobId: string,
    _workerId: string,
    _attemptId: string,
    txHash: string,
    _signedTransaction?: string,
  ): Promise<void> {
    this.calls.push(`submitted:${txHash}`);
  }

  async withMinterLock<T>(_chainId: number, _minterAddress: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  unconfirmedSigned: UnconfirmedSignedTransaction[] = [];

  async listUnconfirmedSignedTransactions(): Promise<UnconfirmedSignedTransaction[]> {
    return this.unconfirmedSigned;
  }

  async finalize(_item: MintWorkItem, _workerId: string, _attemptId: string | undefined, value: ChainMintResult): Promise<void> {
    this.calls.push(`finalized:${value.tokenId}`);
  }

  async releaseRetryable(_jobId: string, _workerId: string, code: string): Promise<void> {
    this.calls.push(`retryable:${code}`);
  }

  async releaseRevertedForRetry(
    _jobId: string,
    _workerId: string,
    _attemptId: string,
    revertCode: string,
    retryCode: string,
  ): Promise<void> {
    this.calls.push(`reverted-retry:${revertCode}:${retryCode}`);
  }

  async findAttemptIdForTransactionHash(): Promise<string | undefined> {
    this.calls.push('findAttempt');
    return this.recoveredAttemptId;
  }

  async markManualReview(_jobId: string, _workerId: string, code: string): Promise<void> {
    this.calls.push(`review:${code}`);
  }

  async renewLease(): Promise<void> {
    this.calls.push('renewed');
    this.renewCount += 1;
    if (this.renewError || this.renewCount === this.failRenewAt) {
      throw this.renewError ?? new Error('MINT_JOB_LEASE_LOST');
    }
  }
}

class FakeGateway implements MintChainGateway {
  readonly minterAddress = '0x9000000000000000000000000000000000000009';
  calls: string[] = [];
  existing?: ChainMintResult;
  submitError?: Error;
  confirmError?: Error;
  assertCanSubmitError?: Error;

  async validate(): Promise<void> {
    this.calls.push('validate');
  }

  async assertCanSubmit(): Promise<void> {
    this.calls.push('assertCanSubmit');
    if (this.assertCanSubmitError) throw this.assertCanSubmitError;
  }

  async findMintByRewardKey(): Promise<ChainMintResult | undefined> {
    this.calls.push('find');
    return this.existing;
  }

  async submitMint(
    _item: MintWorkItem,
    persistBeforeBroadcast: (record: { transactionHash: string }) => Promise<void>,
  ): Promise<{ transactionHash: string }> {
    this.calls.push('submit');
    if (this.submitError) throw this.submitError;
    await persistBeforeBroadcast({ transactionHash: result.transactionHash });
    return { transactionHash: result.transactionHash };
  }

  async rebroadcastIfNeeded(): Promise<void> {
    this.calls.push('rebroadcast');
  }

  async confirmMint(): Promise<ChainMintResult> {
    this.calls.push('confirm');
    if (this.confirmError) throw this.confirmError;
    return result;
  }
}

test('submits and finalizes one leased mint job', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(workCalls(repository), [
    'lease',
    'prepared',
    `submitted:${result.transactionHash}`,
    'finalized:1',
  ]);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'assertCanSubmit', 'submit', 'confirm']);
  assert.equal(await worker.runOnce('worker-1'), false);
});

test('M02 recovers an unknown submission from the existing reward key without resubmitting', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.submitError = new SubmissionOutcomeUnknownError('RPC_RESPONSE_LOST');
  let lookupCount = 0;
  gateway.findMintByRewardKey = async () => {
    gateway.calls.push('find');
    lookupCount += 1;
    return lookupCount === 2 ? result : undefined;
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'assertCanSubmit', 'submit', 'find']);
  assert.equal(gateway.calls.filter((call) => call === 'submit').length, 1);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
});

test('M04 pauses before submission when chain or contract configuration is wrong', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.validate = async () => {
    throw new ChainConfigurationError('CHAIN_OR_CONTRACT_MISMATCH');
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(workCalls(repository), ['lease', 'review:CHAIN_OR_CONTRACT_MISMATCH']);
  assert.deepEqual(gateway.calls, []);
});

test('M05 rejects a successful receipt whose mint event does not match the job', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_EVENT_MISMATCH');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.equal(workCalls(repository).at(-1), 'review:MINT_EVENT_MISMATCH');
  assert.equal(repository.calls.some((call) => call.startsWith('finalized:')), false);
});

test('an exhausted legacy series goes straight to manual review without retrying', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.submitError = new ChainConfigurationError('SERIES_SUPPLY_EXCEEDED');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.equal(workCalls(repository).at(-1), 'review:SERIES_SUPPLY_EXCEEDED');
  assert.equal(repository.calls.some((call) => call.startsWith('retryable:')), false);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'assertCanSubmit', 'submit']);
});

test('recovers an existing reward key when a duplicate submitted transaction reverts', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_TRANSACTION_REVERTED');
  let lookupCount = 0;
  gateway.findMintByRewardKey = async () => {
    gateway.calls.push('find');
    lookupCount += 1;
    return lookupCount === 2 ? result : undefined;
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, [
    'validate',
    'find',
    'assertCanSubmit',
    'submit',
    'confirm',
    'find',
  ]);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
  assert.equal(workCalls(repository).some((call) => call.startsWith('review:')), false);
});

test('O05 retries a submitted transaction that reverted from a transient pause instead of manual review', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_TRANSACTION_REVERTED');
  let assertCanSubmitCount = 0;
  gateway.assertCanSubmit = async () => {
    gateway.calls.push('assertCanSubmit');
    assertCanSubmitCount += 1;
    if (assertCanSubmitCount === 2) throw new RetryableChainError('MINT_PAUSED');
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, [
    'validate',
    'find',
    'assertCanSubmit',
    'submit',
    'confirm',
    'find',
    'assertCanSubmit',
  ]);
  assert.deepEqual(workCalls(repository), [
    'lease',
    'prepared',
    `submitted:${result.transactionHash}`,
    'reverted-retry:MINT_TRANSACTION_REVERTED:MINT_PAUSED',
  ]);
  assert.equal(workCalls(repository).some((call) => call.startsWith('review:')), false);
});

test('O05 sends a permanently reverted submission to manual review when the recheck passes', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_TRANSACTION_REVERTED');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, [
    'validate',
    'find',
    'assertCanSubmit',
    'submit',
    'confirm',
    'find',
    'assertCanSubmit',
  ]);
  assert.deepEqual(workCalls(repository), [
    'lease',
    'prepared',
    `submitted:${result.transactionHash}`,
    'review:MINT_TRANSACTION_REVERTED',
  ]);
  assert.equal(workCalls(repository).some((call) => call.startsWith('reverted-retry:')), false);
});

test('renews a short lease while chain confirmation is still running', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmMint = async () => {
    gateway.calls.push('confirm');
    await new Promise((resolve) => setTimeout(resolve, 80));
    return result;
  };
  const worker = new MintWorker(repository, gateway, 30);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.ok(repository.calls.filter((call) => call === 'renewed').length >= 2);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
});

test('does not submit after the lease heartbeat loses ownership', async () => {
  const repository = new FakeRepository();
  repository.renewError = new Error('MINT_JOB_LEASE_LOST');
  const gateway = new FakeGateway();
  gateway.findMintByRewardKey = async () => {
    gateway.calls.push('find');
    await new Promise((resolve) => setTimeout(resolve, 40));
    return undefined;
  };
  const worker = new MintWorker(repository, gateway, 30);

  await assert.rejects(worker.runOnce('worker-1'), /MINT_JOB_LEASE_LOST/);
  assert.equal(gateway.calls.includes('submit'), false);
});

test('rechecks lease ownership after preparing and before submitting', async () => {
  const repository = new FakeRepository();
  repository.failRenewAt = 3;
  const gateway = new FakeGateway();
  const worker = new MintWorker(repository, gateway, 30_000);

  await assert.rejects(worker.runOnce('worker-1'), /MINT_JOB_LEASE_LOST/);
  assert.equal(repository.calls.includes('prepared'), true);
  assert.equal(gateway.calls.includes('submit'), false);
});

test('O02 blocks submission without consuming an attempt when assertCanSubmit is retryable', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.assertCanSubmitError = new RetryableChainError('MINT_PAUSED');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'assertCanSubmit']);
  assert.equal(repository.calls.includes('prepared'), false);
  assert.deepEqual(workCalls(repository), ['lease', 'retryable:MINT_PAUSED']);
});

test('O02 finalizes an already-minted reward key even when assertCanSubmit would fail', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.existing = result;
  gateway.assertCanSubmitError = new RetryableChainError('MINT_PAUSED');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find']);
  assert.equal(gateway.calls.includes('assertCanSubmit'), false);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
});

test('O02 confirms an already submitted transaction even when assertCanSubmit would fail', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    return { ...work, transactionHash: result.transactionHash };
  };
  const gateway = new FakeGateway();
  gateway.assertCanSubmitError = new RetryableChainError('MINTER_BALANCE_LOW');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.equal(gateway.calls.includes('assertCanSubmit'), false);
  assert.equal(gateway.calls.includes('submit'), false);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
});

test('restart recovery retries a reverted receipt from a transient pause the same way a fresh submission does', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    return { ...work, transactionHash: result.transactionHash };
  };
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_TRANSACTION_REVERTED');
  let assertCanSubmitCount = 0;
  gateway.assertCanSubmit = async () => {
    gateway.calls.push('assertCanSubmit');
    assertCanSubmitCount += 1;
    if (assertCanSubmitCount === 1) throw new RetryableChainError('MINT_PAUSED');
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'confirm', 'find', 'assertCanSubmit']);
  assert.deepEqual(workCalls(repository), [
    'lease',
    'findAttempt',
    'reverted-retry:MINT_TRANSACTION_REVERTED:MINT_PAUSED',
  ]);
  assert.equal(workCalls(repository).some((call) => call.startsWith('review:')), false);
});

test('restart recovery sends a permanently reverted receipt to manual review the same way a fresh submission does', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    return { ...work, transactionHash: result.transactionHash };
  };
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_TRANSACTION_REVERTED');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'confirm', 'find', 'assertCanSubmit']);
  assert.deepEqual(workCalls(repository), ['lease', 'review:MINT_TRANSACTION_REVERTED']);
  assert.equal(repository.calls.includes('findAttempt'), false);
});

test('restart recovery does not resubmit when the receipt for the stored hash is not yet available', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    return { ...work, transactionHash: result.transactionHash };
  };
  const gateway = new FakeGateway();
  gateway.confirmError = new RetryableChainError('RECEIPT_NOT_READY');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'confirm']);
  assert.equal(gateway.calls.includes('submit'), false);
  assert.deepEqual(workCalls(repository), ['lease', 'retryable:RECEIPT_NOT_READY']);
});

test('restart recovery finalizes without resubmitting when the reward key was already minted', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    return { ...work, transactionHash: result.transactionHash };
  };
  const gateway = new FakeGateway();
  gateway.existing = result;
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find']);
  assert.equal(gateway.calls.includes('confirm'), false);
  assert.equal(gateway.calls.includes('submit'), false);
  assert.equal(workCalls(repository).at(-1), 'finalized:1');
});

test('signed transactions recorded but never broadcast are sent before a new nonce is taken', async () => {
  const repository = new FakeRepository();
  repository.unconfirmedSigned = [
    { transactionHash: `0x${'01'.repeat(32)}`, signedTransaction: '0x02f801', intent: work },
    { transactionHash: `0x${'02'.repeat(32)}`, signedTransaction: '0x02f802', intent: work },
  ];
  const gateway = new FakeGateway();
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  // Both stragglers go out, in order, before this job's own submission reads the pending nonce.
  assert.deepEqual(gateway.calls, [
    'validate',
    'find',
    'assertCanSubmit',
    'rebroadcast',
    'rebroadcast',
    'submit',
    'confirm',
  ]);
});

test('an over-full backlog of unconfirmed signed transactions blocks submission instead of guessing a nonce', async () => {
  const repository = new FakeRepository();
  repository.listUnconfirmedSignedTransactions = async () => {
    throw new RetryableChainError('MINTER_UNCONFIRMED_BACKLOG');
  };
  const gateway = new FakeGateway();
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.equal(gateway.calls.includes('submit'), false);
  assert.deepEqual(workCalls(repository), ['lease', 'retryable:MINTER_NONCE_BLOCKED']);
});

test('H1 a straggler that cannot be rebroadcast releases this job without consuming an attempt', async () => {
  const repository = new FakeRepository();
  repository.unconfirmedSigned = [
    { transactionHash: `0x${'01'.repeat(32)}`, signedTransaction: '0x02f801', intent: work },
  ];
  const gateway = new FakeGateway();
  gateway.rebroadcastIfNeeded = async () => {
    gateway.calls.push('rebroadcast');
    throw new RetryableChainError('MINT_BROADCAST_FAILED');
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'assertCanSubmit', 'rebroadcast']);
  // markPrepared never ran: the straggler was discovered before this job's own attempt could be
  // consumed, and the job is released under its own code rather than the straggler's error code.
  assert.equal(repository.calls.includes('prepared'), false);
  assert.equal(gateway.calls.includes('submit'), false);
  assert.deepEqual(workCalls(repository), ['lease', 'retryable:MINTER_NONCE_BLOCKED']);
});

test('O02 propagates a repository failure before leasing without calling the gateway', async () => {
  const repository = new FakeRepository();
  repository.leaseNext = async () => {
    repository.calls.push('lease');
    throw new Error('DATABASE_UNAVAILABLE');
  };
  const gateway = new FakeGateway();
  const worker = new MintWorker(repository, gateway);

  await assert.rejects(worker.runOnce('worker-1'), /DATABASE_UNAVAILABLE/);
  assert.deepEqual(gateway.calls, []);
});
