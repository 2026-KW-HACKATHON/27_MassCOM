import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FeeData,
  Interface,
  Transaction,
  Wallet,
  makeError,
  type JsonRpcApiProvider,
  type JsonRpcProvider,
  type Log,
} from 'ethers';

import { EthersMintChainGateway, contractCallError } from './ethers-chain-gateway.js';
import {
  ChainConfigurationError,
  MintEventMismatchError,
  RetryableChainError,
  type MintWorkItem,
} from './mint-worker.js';

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

const legacyErrors = new Interface(['error SeriesSupplyExceeded(bytes32 seriesId,uint64 maxEverMinted)']);
const supplyExceeded = () => callException(legacyErrors.encodeErrorResult('SeriesSupplyExceeded', [
  item.seriesKey, 1n,
]));

test('an exhausted legacy series is a permanent configuration error', () => {
  const classified = contractCallError(supplyExceeded());
  assert.ok(classified instanceof ChainConfigurationError);
  assert.equal(classified.code, 'SERIES_SUPPLY_EXCEEDED');
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

test('gas estimation fails fast for legacy supply exhaustion and keeps outages retryable', async (t) => {
  const signer = Wallet.createRandom();
  const gateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1', chainId: item.chainId, contractAddress: item.contractAddress,
    minterAddress: signer.address, confirmations: 1, fromBlock: 0, signer,
  });
  t.after(() => gateway.close());
  const provider = internalProvider(gateway);
  provider.getTransactionCount = async () => 0;
  provider.getFeeData = async () => new FeeData(null, 2n, 1n);
  let persisted = false;
  for (const error of [supplyExceeded(), callException(null), callException('0x08c379a0')]) {
    provider.estimateGas = async () => { throw error; };
    await assert.rejects(gateway.submitMint(item, async () => { persisted = true; }),
      (actual: unknown) => error.data === supplyExceeded().data
        ? actual instanceof ChainConfigurationError && actual.code === 'SERIES_SUPPLY_EXCEEDED'
        : actual instanceof RetryableChainError && actual.code === 'RPC_UNAVAILABLE');
  }
  assert.equal(persisted, false);
});

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

// confirmMint의 영수증 대기. ethers 6.17의 waitForTransaction은 조회 오류를 RPC 주소째 console.log하고, 비동기 Promise
// 실행기 안에서 던져 처리되지 않은 거절로 프로세스를 죽이며, 시간 초과 뒤에도 리스너를 남긴다. 직접 만든 유한 조회로 대체했다.
const rpcSecret = 'https://base-sepolia.example/v2/SECRET-API-KEY-1234';

type ReceiptProvider = {
  getTransactionReceipt(hash: string): Promise<unknown>;
  getBlockNumber(): Promise<number>;
  destroy(): void;
};

function receiptGateway(overrides: Partial<ReceiptProvider>, confirmations = 1) {
  const gateway = new EthersMintChainGateway({
    rpcUrl: rpcSecret, chainId: item.chainId, contractAddress: item.contractAddress,
    minterAddress: '0x5000000000000000000000000000000000000005', confirmations, fromBlock: 0,
    receiptWaitMs: 60, receiptPollMs: 10,
  });
  const provider = (gateway as unknown as { provider: ReceiptProvider }).provider;
  provider.getTransactionReceipt = async () => null;
  provider.getBlockNumber = async () => 0;
  Object.assign(provider, overrides);
  return { gateway, provider };
}

const timeoutCount = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = `0x${'cc'.repeat(32)}`;

test('영수증 조회가 RPC 주소가 든 오류를 던져도 아무것도 로그로 남기지 않고 코드만 있는 재시도 오류가 된다', async (t) => {
  const logged: unknown[][] = [];
  for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { logged.push(args); });
  }
  const failing = () => Promise.reject(new Error(`could not coalesce error (url=${rpcSecret})`));
  const { gateway } = receiptGateway({ getTransactionReceipt: failing, getBlockNumber: failing });

  const error = await gateway.confirmMint(item, hash).catch((caught: unknown) => caught);

  assert.ok(error instanceof RetryableChainError);
  assert.equal(error.code, 'RECEIPT_LOOKUP_FAILED');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(`${error.message} ${error.stack}`, /SECRET-API-KEY/);
  assert.deepEqual(logged, []);
  gateway.close();
});

test('getBlockNumber만 실패해도 처리되지 않은 거절 없이 재시도 오류로 끝난다', async (t) => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => { unhandled.push(reason); };
  process.on('unhandledRejection', record);
  t.after(() => { process.off('unhandledRejection', record); });
  const { gateway } = receiptGateway({
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 7, logs: [] }),
    getBlockNumber: () => Promise.reject(new Error(`connect failed ${rpcSecret}`)),
  });

  await assert.rejects(
    gateway.confirmMint(item, hash),
    (caught: unknown) => caught instanceof RetryableChainError && caught.code === 'RECEIPT_LOOKUP_FAILED',
  );
  await settle(20);
  assert.deepEqual(unhandled, []);
  gateway.close();
});

test('영수증이 아직 없으면 기한까지 여러 번 다시 조회한 뒤 RECEIPT_NOT_READY 재시도 오류가 된다', async () => {
  let calls = 0;
  const { gateway } = receiptGateway({ getTransactionReceipt: async () => { calls += 1; return null; } });
  const startedAt = Date.now();

  await assert.rejects(
    gateway.confirmMint(item, hash),
    (caught: unknown) => caught instanceof RetryableChainError && caught.code === 'RECEIPT_NOT_READY',
  );

  assert.ok(Date.now() - startedAt >= 55, '기한(60ms)보다 일찍 포기하면 안 된다');
  assert.ok(calls >= 3, `기한 안에서 계속 조회해야 한다(조회 ${calls}회)`);
  gateway.close();
});

test('기한이 지나면 조회가 멈추고 남는 타이머가 없다', async () => {
  let calls = 0;
  const timersBefore = timeoutCount();
  const { gateway } = receiptGateway({ getTransactionReceipt: async () => { calls += 1; return null; } });

  await assert.rejects(gateway.confirmMint(item, hash), RetryableChainError);
  const callsAtDeadline = calls;
  await settle(60);

  assert.equal(calls, callsAtDeadline, '기한 뒤에도 조회가 이어졌다');
  assert.ok(timeoutCount() <= timersBefore, '기한 뒤에도 타이머가 남았다');
  gateway.close();
});

test('확인 깊이가 찰 때까지 기다린 뒤 영수증을 돌려준다', async () => {
  const receipt = { status: 0, blockNumber: 10, logs: [] };
  const heads = [10, 10, 11];
  const { gateway } = receiptGateway({
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => heads.shift() ?? 11,
  }, 2);

  // 깊이 2가 차면(블록 11) 영수증을 받고, 되돌려진 거래이므로 영구 오류로 닫힌다.
  await assert.rejects(
    gateway.confirmMint(item, hash),
    (caught: unknown) => caught instanceof MintEventMismatchError && caught.code === 'MINT_TRANSACTION_REVERTED',
  );
  assert.deepEqual(heads, []);
  gateway.close();
});

test('깊이가 영영 차지 않으면 되돌려진 거래로 단정하지 않고 RECEIPT_NOT_READY 재시도 오류가 된다', async () => {
  const { gateway } = receiptGateway({
    getTransactionReceipt: async () => ({ status: 0, blockNumber: 10, logs: [] }),
    getBlockNumber: async () => 10,
  }, 2);

  await assert.rejects(
    gateway.confirmMint(item, hash),
    (caught: unknown) => caught instanceof RetryableChainError && caught.code === 'RECEIPT_NOT_READY',
  );
  gateway.close();
});

// 기한에 마지막으로 한 조회가 코드를 정한다: 앞서 실패했어도 마지막 조회가 깨끗하면 NOT_READY, 앞서 깨끗했어도 마지막이 실패하면 LOOKUP_FAILED.
// 두 코드 모두 같은 RetryableChainError라 mint-worker는 같은 방식으로 재시도 대기로 돌린다(코드는 기록만 된다).
test('영수증 대기의 마지막 조회가 실패했는지에 따라 RECEIPT_LOOKUP_FAILED와 RECEIPT_NOT_READY가 갈린다', async () => {
  const outcome = async (polls: Array<'fail' | 'empty'>) => {
    let index = 0;
    const { gateway } = receiptGateway({
      getTransactionReceipt: async () => {
        const poll = polls[Math.min(index, polls.length - 1)];
        index += 1;
        if (poll === 'fail') throw new Error(`connect failed ${rpcSecret}`);
        return null;
      },
    });
    const error = await gateway.confirmMint(item, hash).catch((caught: unknown) => caught);
    gateway.close();
    assert.ok(error instanceof RetryableChainError);
    return error.code;
  };

  assert.equal(await outcome(['empty', 'fail']), 'RECEIPT_LOOKUP_FAILED');
  assert.equal(await outcome(['fail', 'empty']), 'RECEIPT_NOT_READY');
});

test('RPC 요청 하나는 10초를 넘기지 않는다(ethers 기본값은 300초)', () => {
  const { gateway } = receiptGateway({});
  const connection = (gateway as unknown as { provider: JsonRpcProvider }).provider._getConnection();

  assert.equal(connection.timeout, 10_000);
  assert.equal(connection.url, rpcSecret);
  gateway.close();
});

test('close는 공급자를 정리한다', () => {
  let destroyed = 0;
  const { gateway } = receiptGateway({ destroy: () => { destroyed += 1; } });

  gateway.close();

  assert.equal(destroyed, 1);
});
