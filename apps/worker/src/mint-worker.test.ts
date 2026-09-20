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

  async markSubmitted(_jobId: string, _workerId: string, _attemptId: string, txHash: string): Promise<void> {
    this.calls.push(`submitted:${txHash}`);
  }

  async finalize(_item: MintWorkItem, _workerId: string, _attemptId: string | undefined, value: ChainMintResult): Promise<void> {
    this.calls.push(`finalized:${value.tokenId}`);
  }

  async releaseRetryable(_jobId: string, _workerId: string, code: string): Promise<void> {
    this.calls.push(`retryable:${code}`);
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

  async submitMint(): Promise<{ transactionHash: string }> {
    this.calls.push('submit');
    if (this.submitError) throw this.submitError;
    return { transactionHash: result.transactionHash };
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
