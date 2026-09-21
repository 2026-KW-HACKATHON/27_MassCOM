import assert from 'node:assert/strict';
import test from 'node:test';

import { FeeData, Transaction, Wallet, makeError, type JsonRpcApiProvider } from 'ethers';

import { EthersMintChainGateway, contractCallError } from './ethers-chain-gateway.js';
import { ChainConfigurationError, RetryableChainError, type MintWorkItem } from './mint-worker.js';

const callException = (data: string | null) =>
  makeError('call failed', 'CALL_EXCEPTION', {
    action: 'call',
    data,
    reason: null,
    transaction: { to: null, data: '0x' },
    invocation: null,
    revert: null,
  });

test('O02 a node error without EVM return data is an outage, not a contract mismatch', () => {
  for (const error of [
    callException(null),
    makeError('missing response for request', 'BAD_DATA', { value: [], info: { payload: {} } }),
    makeError('cancelled request', 'UNSUPPORTED_OPERATION', { operation: 'provider destroyed' }),
    makeError('connection refused', 'NETWORK_ERROR', { event: 'request' }),
    makeError('timeout', 'TIMEOUT', { operation: 'request', reason: 'timeout' }),
    new Error('socket hang up'),
  ]) {
    const classified = contractCallError(error);
    assert.ok(classified instanceof RetryableChainError, String(error));
    assert.equal(classified.code, 'RPC_UNAVAILABLE');
  }
});

test('O02 a real revert or undecodable return data is a contract interface mismatch', () => {
  for (const error of [
    callException('0x'),
    callException('0x08c379a0'),
    makeError('could not decode result data', 'BAD_DATA', { value: '0x', info: {} }),
  ]) {
    const classified = contractCallError(error);
    assert.ok(classified instanceof ChainConfigurationError, String(error));
    assert.equal(classified.code, 'CONTRACT_INTERFACE_MISMATCH');
  }
});

function internalProvider(gateway: EthersMintChainGateway): JsonRpcApiProvider & {
  getTransactionCount: (address: string, blockTag?: string) => Promise<number>;
  getFeeData: () => Promise<FeeData>;
  estimateGas: (tx: unknown) => Promise<bigint>;
} {
  return (
    gateway as unknown as {
      provider: JsonRpcApiProvider & {
        getTransactionCount: (address: string, blockTag?: string) => Promise<number>;
        getFeeData: () => Promise<FeeData>;
        estimateGas: (tx: unknown) => Promise<bigint>;
      };
    }
  ).provider;
}

const item: MintWorkItem = {
  jobId: 'job-1',
  outboxId: 'outbox-1',
  accountId: 'customer-1',
  entitlementId: 'entitlement-1',
  rewardKey: `0x${'11'.repeat(32)}`,
  recipient: '0x4000000000000000000000000000000000000004',
  chainId: 84532,
  contractAddress: '0x7000000000000000000000000000000000000007',
  seriesKey: `0x${'33'.repeat(32)}`,
};

test('H2 a fresh submission signs nothing and records nothing when fee data is unavailable', async () => {
  const signer = Wallet.createRandom();
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1',
    chainId: 84532,
    contractAddress: item.contractAddress,
    minterAddress: signer.address,
    confirmations: 1,
    fromBlock: 0,
    signer,
  });
  const provider = internalProvider(gateway);
  provider.getTransactionCount = async () => 0;
  provider.estimateGas = async () => 21_000n;
  let persisted = false;

  for (const feeData of [
    new FeeData(null, null, 1n),
    new FeeData(null, 1n, null),
    new FeeData(null, 0n, 1n),
    new FeeData(null, -1n, 1n),
    new FeeData(null, 2n, 0n),
    new FeeData(null, 2n, 3n),
  ]) {
    provider.getFeeData = async () => feeData;
    await assert.rejects(
      gateway.submitMint({ ...item, recipient: signer.address }, async () => {
        persisted = true;
      }),
      (error: unknown) =>
        error instanceof RetryableChainError && error.code === 'FEE_DATA_UNAVAILABLE',
    );
  }
  assert.equal(persisted, false);
});

test('a service signer cannot persist a transaction from a different address', async () => {
  const configuredMinter = Wallet.createRandom();
  const foreignSigner = Wallet.createRandom();
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1',
    chainId: 84532,
    contractAddress: item.contractAddress,
    minterAddress: configuredMinter.address,
    confirmations: 1,
    fromBlock: 0,
    signer: foreignSigner,
  });
  const provider = internalProvider(gateway);
  provider.getTransactionCount = async () => 0;
  provider.estimateGas = async () => 21_000n;
  provider.getFeeData = async () => new FeeData(null, 2n, 1n);
  let persisted = false;

  await assert.rejects(
    gateway.submitMint(item, async () => {
      persisted = true;
    }),
    (error: unknown) =>
      error instanceof RetryableChainError && error.code === 'MINTER_SIGNER_MISMATCH',
  );
  assert.equal(persisted, false);
});

test('rebroadcast refuses a stored transaction whose mint intent differs from the job', async () => {
  const signer = Wallet.createRandom();
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1',
    chainId: 84532,
    contractAddress: item.contractAddress,
    minterAddress: signer.address,
    confirmations: 1,
    fromBlock: 0,
    signer,
  });
  const wrongIntent = await signer.signTransaction({
    type: 2,
    to: item.contractAddress,
    data: '0x',
    nonce: 0,
    chainId: item.chainId,
    gasLimit: 21_000n,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
  });
  const hash = Transaction.from(wrongIntent).hash!;

  await assert.rejects(
    (gateway as unknown as {
      rebroadcastIfNeeded(
        intent: MintWorkItem,
        transactionHash: string,
        signedTransaction: string,
      ): Promise<void>;
    }).rebroadcastIfNeeded(item, hash, wrongIntent),
    (error: unknown) =>
      error instanceof RetryableChainError &&
      error.code === 'MINT_SIGNED_TRANSACTION_MISMATCH',
  );
});
