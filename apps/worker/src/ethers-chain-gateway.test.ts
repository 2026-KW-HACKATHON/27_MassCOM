import assert from 'node:assert/strict';
import test from 'node:test';

import { FeeData, Transaction, Wallet, makeError, type JsonRpcApiProvider, type Log } from 'ethers';

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

test('a reorged mint event is retried instead of finalizing against a different canonical block', async () => {
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1', chainId: item.chainId, contractAddress: item.contractAddress,
    minterAddress: '0x5000000000000000000000000000000000000005', confirmations: 1, fromBlock: 0,
  });
  const internals = gateway as unknown as {
    contractInterface: { getEvent(name: string): unknown; encodeEventLog(fragment: unknown, values: unknown[]): { data: string; topics: string[] } };
    contract: { getFunction(name: string): { staticCall(): Promise<unknown> } };
    resultFromEvent(work: MintWorkItem, event: Log, tokenId?: bigint): Promise<unknown>;
  };
  const fragment = internals.contractInterface.getEvent('MascotMinted');
  const encoded = internals.contractInterface.encodeEventLog(fragment, [item.rewardKey, 7n, item.recipient, item.seriesKey]);
  const event = {
    ...encoded, address: item.contractAddress, blockNumber: 42,
    blockHash: `0x${'aa'.repeat(32)}`, transactionHash: `0x${'cc'.repeat(32)}`,
  } as unknown as Log;
  internals.contract = {
    getFunction(name) {
      return { staticCall: async () => ({ ownerOf: '0x6000000000000000000000000000000000000006', seriesByToken: item.seriesKey, locked: true })[name] };
    },
  };
  const provider = internalProvider(gateway);
  provider.getBlock = async () => ({ hash: `0x${'bb'.repeat(32)}` }) as Awaited<ReturnType<typeof provider.getBlock>>;

  await assert.rejects(
    internals.resultFromEvent(item, event),
    (error: unknown) => error instanceof RetryableChainError && error.code === 'MINT_EVENT_NOT_FINALIZED',
  );
});

test('a missing canonical mint block remains retryable rather than becoming a permanent state mismatch', async () => {
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1', chainId: item.chainId, contractAddress: item.contractAddress,
    minterAddress: '0x5000000000000000000000000000000000000005', confirmations: 1, fromBlock: 0,
  });
  const internals = gateway as unknown as {
    contractInterface: { getEvent(name: string): unknown; encodeEventLog(fragment: unknown, values: unknown[]): { data: string; topics: string[] } };
    resultFromEvent(work: MintWorkItem, event: Log, tokenId?: bigint): Promise<unknown>;
  };
  const encoded = internals.contractInterface.encodeEventLog(
    internals.contractInterface.getEvent('MascotMinted'),
    [item.rewardKey, 7n, item.recipient, item.seriesKey],
  );
  const event = {
    ...encoded, address: item.contractAddress, blockNumber: 42,
    blockHash: `0x${'aa'.repeat(32)}`, transactionHash: `0x${'cc'.repeat(32)}`,
  } as unknown as Log;
  internalProvider(gateway).getBlock = async () => null;

  await assert.rejects(
    internals.resultFromEvent(item, event),
    (error: unknown) => error instanceof RetryableChainError && error.code === 'MINT_EVENT_NOT_FINALIZED',
  );
});

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

test('상시 실행: 조회 시작 블록을 갱신하면 이후 이벤트 조회가 그 블록부터 시작한다', async () => {
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1', chainId: item.chainId, contractAddress: item.contractAddress,
    minterAddress: '0x5000000000000000000000000000000000000005', confirmations: 1,
    fromBlock: 100, fallbackFromBlock: 50,
  });
  const internals = gateway as unknown as {
    contract: { getFunction(name: string): { staticCall(...args: unknown[]): Promise<unknown> } };
    provider: {
      send(method: string, params: unknown[]): Promise<unknown>;
      getLogs(filter: { fromBlock: number; toBlock: number }): Promise<unknown[]>;
    };
  };
  internals.contract.getFunction = () => ({ staticCall: async () => 5n });
  internals.provider.send = async () => '0x3e8';
  const ranges: number[][] = [];
  internals.provider.getLogs = async (filter) => {
    ranges.push([filter.fromBlock, filter.toBlock]);
    return [];
  };
  const notFound = (error: unknown) => (error as { code?: string }).code === 'MINT_EVENT_NOT_FOUND';

  await assert.rejects(gateway.findMintByRewardKey(item), notFound);
  assert.deepEqual(ranges, [[100, 1000], [50, 99]]);

  gateway.setScanFromBlock(700);
  ranges.length = 0;
  await assert.rejects(gateway.findMintByRewardKey(item), notFound);
  assert.deepEqual(ranges, [[700, 1000], [50, 699]]);

  // 조회 하한(fallback) 아래이거나 정수가 아닌 값은 거절하고 기존 값을 유지한다.
  for (const invalid of [-1, 49, 1.5, Number.NaN]) {
    assert.throws(() => gateway.setScanFromBlock(invalid), invalid.toString());
  }
  ranges.length = 0;
  await assert.rejects(gateway.findMintByRewardKey(item), notFound);
  assert.deepEqual(ranges, [[700, 1000], [50, 699]]);
});
