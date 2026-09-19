import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ChainConfigurationError,
  MintEventMismatchError,
  MintWorker,
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

class FakeRepository implements MintWorkRepository {
  leased = false;
  calls: string[] = [];

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
}

class FakeGateway implements MintChainGateway {
  calls: string[] = [];
  existing?: ChainMintResult;
  submitError?: Error;
  confirmError?: Error;

  async validate(): Promise<void> {
    this.calls.push('validate');
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
  assert.deepEqual(repository.calls, [
    'lease',
    'prepared',
    `submitted:${result.transactionHash}`,
    'finalized:1',
  ]);
  assert.deepEqual(gateway.calls, ['validate', 'find', 'submit', 'confirm']);
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
  assert.deepEqual(gateway.calls, ['validate', 'find', 'submit', 'find']);
  assert.equal(gateway.calls.filter((call) => call === 'submit').length, 1);
  assert.equal(repository.calls.at(-1), 'finalized:1');
});

test('M04 pauses before submission when chain or contract configuration is wrong', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.validate = async () => {
    throw new ChainConfigurationError('CHAIN_OR_CONTRACT_MISMATCH');
  };
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.deepEqual(repository.calls, ['lease', 'review:CHAIN_OR_CONTRACT_MISMATCH']);
  assert.deepEqual(gateway.calls, []);
});

test('M05 rejects a successful receipt whose mint event does not match the job', async () => {
  const repository = new FakeRepository();
  const gateway = new FakeGateway();
  gateway.confirmError = new MintEventMismatchError('MINT_EVENT_MISMATCH');
  const worker = new MintWorker(repository, gateway);

  assert.equal(await worker.runOnce('worker-1'), true);
  assert.equal(repository.calls.at(-1), 'review:MINT_EVENT_MISMATCH');
  assert.equal(repository.calls.some((call) => call.startsWith('finalized:')), false);
});
