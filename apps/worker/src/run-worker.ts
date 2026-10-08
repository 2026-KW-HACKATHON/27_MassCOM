import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { EthersMintChainGateway } from './ethers-chain-gateway.js';
import { MintWorker } from './mint-worker.js';
import { resolveMinterSigner } from './minter-signer-config.js';
import { parseNftMetadataOrigin } from './nft-metadata.js';
import { PostgresMintRepository } from './postgres-mint-repository.js';

/**
 * 설정 검증·키 복호화·DB 풀·체인 게이트웨이를 한 번만 만들고, 이후 `runOnce`를 여러 번 부를 수 있게 한다.
 * 상시 실행 루프가 이 객체를 재사용해 반복마다 keystore를 다시 복호화하지 않는다.
 */
export type ConfiguredWorker = {
  runOnce(): Promise<boolean>;
  close(): Promise<void>;
};

// ethers·pg 오류 메시지에는 RPC 주소(키 포함 가능)나 연결 문자열이 들어갈 수 있어 이름과 코드만 남긴다.
// 환경변수 검증 메시지("NAME is required", "NAME must be ...")는 변수 이름만 담으므로 원인 파악을 위해 남긴다.
const configMessage = /^[A-Z][A-Z0-9_]+ (is required|must )[^\r\n]*$/;

export function safeErrorFields(error: unknown): { name: string; code?: string; message?: string } {
  if (!(error instanceof Error)) return { name: 'NonError' };
  const code = (error as Error & { code?: unknown }).code;
  return {
    name: error.name,
    ...(typeof code === 'string' ? { code } : {}),
    ...(configMessage.test(error.message) ? { message: error.message } : {}),
  };
}

/**
 * DB 연결의 오류(DB 재시작, `pg_terminate_backend` 등)는 리스너가 없으면 프로세스를 죽인다. 유휴 연결의 오류는 풀이
 * 'error'로 내보내고, 빌려 간(checked-out) 연결의 오류는 풀이 리스너를 떼므로 연결마다 직접 달아야 한다. 한 줄만 남기고 넘기면
 * 다음 질의가 정상 경로로 실패해 백오프한다(망가진 연결은 반납될 때 풀이 버린다). 같은 오류가 두 경로로 들어와도 한 줄만 남기고,
 * 연결 문자열은 남기지 않는다.
 */
export function createWorkerPool(connectionString: string, max: number): Pool {
  const pool = new Pool({ connectionString, max });
  const reported = new WeakSet<object>();
  const report = (error: unknown): void => {
    if (typeof error === 'object' && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    console.error(JSON.stringify({ event: 'MINT_WORKER_DB_POOL_ERROR', ...safeErrorFields(error) }));
  };
  pool.on('error', report);
  pool.on('connect', (client) => client.on('error', report));
  return pool;
}

/**
 * 반복마다 한 건을 처리하되, 첫 반복 뒤로는 기록된 커서에서 이벤트 조회 시작 블록을 다시 계산해 게이트웨이에 넘긴다.
 * 오래 떠 있는 프로세스의 조회 범위가 시작 시점부터 계속 늘어나지 않게 한다(첫 반복은 시작 때 계산한 값을 쓴다).
 */
export function scanRefreshingRunOnce(deps: {
  repository: { getEventScanStart(chainId: number, contractAddress: string): Promise<number> };
  gateway: { setScanFromBlock(fromBlock: number): void };
  worker: { runOnce(workerId: string): Promise<boolean> };
  chainId: number;
  contractAddress: string;
  workerId: string;
}): () => Promise<boolean> {
  let firstRun = true;
  return async () => {
    if (!firstRun) {
      deps.gateway.setScanFromBlock(
        await deps.repository.getEventScanStart(deps.chainId, deps.contractAddress),
      );
    }
    firstRun = false;
    return deps.worker.runOnce(deps.workerId);
  };
}

/** 컨테이너 둘이 같은 WORKER_ID를 받아도 임대 소유자(lease_owner)가 겹치지 않게 호스트 이름과 pid를 붙인다. */
export function workerLeaseOwner(raw: string | undefined): string {
  return `${raw?.trim() || 'local-mint-worker'}-${hostname()}-${process.pid}`;
}

export async function createConfiguredWorker(environment = process.env): Promise<ConfiguredWorker> {
  const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL');
  const rpcUrl = required(environment.CHAIN_RPC_URL, 'CHAIN_RPC_URL');
  const chainId = requiredInteger(environment.CHAIN_ID, 'CHAIN_ID');
  const contractAddress = required(environment.NFT_CONTRACT_ADDRESS, 'NFT_CONTRACT_ADDRESS');
  const minterAddress = required(environment.MINTER_ADDRESS, 'MINTER_ADDRESS');
  const workerId = workerLeaseOwner(environment.WORKER_ID);
  // 확정 때 고정하는 공개 메타데이터·그림의 출처(Issue #254). 한 번 쓰면 바꿀 수 없으므로 기본값 없이 반드시 받는다.
  const nftMetadataOrigin = parseNftMetadataOrigin(environment.NFT_METADATA_ORIGIN);
  const confirmations = requiredInteger(
    environment.CHAIN_CONFIRMATIONS ?? '1',
    'CHAIN_CONFIRMATIONS',
  );
  const chainFromBlock = requiredNonNegativeInteger(
    environment.CHAIN_FROM_BLOCK ?? '0',
    'CHAIN_FROM_BLOCK',
  );
  const reorgMargin = requiredInteger(
    environment.CHAIN_REORG_MARGIN ?? '12',
    'CHAIN_REORG_MARGIN',
  );
  const minterMinBalanceWei = nonNegativeIntegerBigInt(
    environment.MINTER_MIN_BALANCE_WEI ?? '0',
    'MINTER_MIN_BALANCE_WEI',
  );
  const minterMaxTransactionFeeWei = nonNegativeIntegerBigInt(
    environment.MINTER_MAX_TX_FEE_WEI ?? '10000000000000000',
    'MINTER_MAX_TX_FEE_WEI',
  );
  if (minterMaxTransactionFeeWei === 0n) {
    throw new Error('MINTER_MAX_TX_FEE_WEI must be greater than zero');
  }
  const receiptTimeoutMs = requiredInteger(
    environment.CHAIN_RECEIPT_TIMEOUT_MS ?? String(24 * 60 * 60 * 1_000),
    'CHAIN_RECEIPT_TIMEOUT_MS',
  );
  const lockTimeoutMs = minterLockTimeoutMs(environment.MINTER_LOCK_TIMEOUT_MS);
  const databasePoolMax = workerDatabasePoolMax(environment.WORKER_DATABASE_POOL_MAX);
  // Resolves how the worker signs: the local Anvil unlocked path (chainId 31337, gated on
  // ALLOW_UNLOCKED_LOCAL_MINTER=true, unchanged) or a service signer loaded from an encrypted
  // keystore for an allow-listed public testnet. Throws a MinterConfigurationError otherwise.
  const signerResolution = await resolveMinterSigner({ env: environment, chainId, minterAddress });

  // max >= 4: withMinterLock holds one dedicated connection for the whole
  // sweep -> markPrepared -> submit sequence, while the rest of the repository (lease, finalize,
  // etc.) needs its own connections concurrently; a pool of 1-2 would let the lock holder starve
  // everything else that shares this pool within the same process.
  const pool = createWorkerPool(databaseUrl, databasePoolMax);
  try {
    const repository = new PostgresMintRepository(pool, {
      chainFromBlock,
      reorgMargin,
      receiptTimeoutMs,
      minterLockTimeoutMs: lockTimeoutMs,
      nftMetadataOrigin,
    });
    const scanFromBlock = await repository.getEventScanStart(chainId, contractAddress);
    const gateway = new EthersMintChainGateway({
      rpcUrl,
      chainId,
      contractAddress,
      minterAddress,
      confirmations,
      fromBlock: scanFromBlock,
      fallbackFromBlock: chainFromBlock,
      minMinterBalanceWei: minterMinBalanceWei,
      maxTransactionFeeWei: minterMaxTransactionFeeWei,
      ...(signerResolution.mode === 'service' ? { signer: signerResolution.signer } : {}),
    });
    const worker = new MintWorker(repository, gateway);
    return {
      runOnce: scanRefreshingRunOnce({ repository, gateway, worker, chainId, contractAddress, workerId }),
      async close() {
        gateway.close();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function runConfiguredWorker(environment = process.env): Promise<boolean> {
  const worker = await createConfiguredWorker(environment);
  try {
    return await worker.runOnce();
  } finally {
    await worker.close();
  }
}

export function minterLockTimeoutMs(raw: string | undefined): number {
  return boundedInteger(raw, 10_000, 'MINTER_LOCK_TIMEOUT_MS', 500, 60_000);
}

export function workerDatabasePoolMax(raw: string | undefined): number {
  return boundedInteger(raw, 4, 'WORKER_DATABASE_POOL_MAX', 4, 100);
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredInteger(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requiredNonNegativeInteger(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function nonNegativeIntegerBigInt(value: string, name: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(trimmed);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const processed = await runConfiguredWorker();
  console.log(processed ? 'mint worker processed one job' : 'mint worker found no work');
}
