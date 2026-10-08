import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import test from 'node:test';

import * as runWorker from './run-worker.js';

test('service minter lock timeout and database pool size have bounded environment values', () => {
  const config = runWorker as unknown as {
    minterLockTimeoutMs(raw: string | undefined): number;
    workerDatabasePoolMax(raw: string | undefined): number;
  };
  assert.equal(typeof config.minterLockTimeoutMs, 'function');
  assert.equal(typeof config.workerDatabasePoolMax, 'function');
  assert.equal(config.minterLockTimeoutMs(undefined), 10_000);
  assert.equal(config.workerDatabasePoolMax(undefined), 4);
  assert.equal(config.minterLockTimeoutMs('2500'), 2_500);
  assert.equal(config.workerDatabasePoolMax('12'), 12);

  for (const raw of ['0', '100', '60001', '1.5']) {
    assert.throws(() => config.minterLockTimeoutMs(raw), /MINTER_LOCK_TIMEOUT_MS/, raw);
  }
  for (const raw of ['0', '3', '101', '1.5']) {
    assert.throws(() => config.workerDatabasePoolMax(raw), /WORKER_DATABASE_POOL_MAX/, raw);
  }
});

test('실행기는 NFT_METADATA_ORIGIN 없이 시작하지 않는다(확정 때 고정하는 메타데이터 출처)', async () => {
  const base = {
    DATABASE_URL: 'postgresql://127.0.0.1:1/unused_test',
    CHAIN_RPC_URL: 'http://127.0.0.1:1',
    CHAIN_ID: '31337',
    NFT_CONTRACT_ADDRESS: '0x7000000000000000000000000000000000000007',
    MINTER_ADDRESS: '0x8000000000000000000000000000000000000008',
  };
  for (const origin of [undefined, 'https://masscom.kr/nft-metadata/']) {
    await assert.rejects(
      runWorker.runConfiguredWorker({ ...base, ...(origin ? { NFT_METADATA_ORIGIN: origin } : {}) }),
      /NFT_METADATA_ORIGIN/,
    );
  }
});

test('DB 풀의 유휴 연결 오류는 프로세스를 죽이지 않고 연결 문자열 없이 한 줄만 남긴다', async (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'error', (line: unknown) => { lines.push(String(line)); });
  const pool = runWorker.createWorkerPool('postgresql://127.0.0.1:1/masscom', 4);
  t.after(() => pool.end());

  // 리스너가 없으면 EventEmitter가 'error'를 그대로 던져 프로세스가 죽는다(pg_terminate_backend로 재현됨).
  const terminated = Object.assign(
    new Error('terminating connection to db.internal.example:5432 as user masscom'),
    { code: '57P01' },
  );
  assert.doesNotThrow(() => pool.emit('error', terminated, undefined));

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), { event: 'MINT_WORKER_DB_POOL_ERROR', name: 'Error', code: '57P01' });
  assert.doesNotMatch(lines[0]!, /db\.internal\.example/);
});

test('빌려 간 연결의 오류도 프로세스를 죽이지 않고 한 줄만 남기며, 유휴 연결 오류가 두 경로로 와도 한 줄이다', async (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'error', (line: unknown) => { lines.push(String(line)); });
  const pool = runWorker.createWorkerPool('postgresql://127.0.0.1:1/masscom', 4);
  t.after(() => pool.end());
  // pg-pool은 빌려 줄 때 유휴 리스너를 떼므로, 'connect'로 받은 연결에 직접 단 리스너가 없으면 EventEmitter가 던져 프로세스가 죽는다.
  const client = new EventEmitter();
  pool.emit('connect', client);
  const terminated = (host: string) => Object.assign(
    new Error(`terminating connection to ${host}:5432 as user masscom`),
    { code: '57P01' },
  );

  assert.doesNotThrow(() => client.emit('error', terminated('checked-out.internal.example')));
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!), { event: 'MINT_WORKER_DB_POOL_ERROR', name: 'Error', code: '57P01' });
  assert.doesNotMatch(lines[0]!, /checked-out\.internal\.example/);

  // 유휴 연결의 같은 오류는 연결 리스너와 풀 'error' 양쪽으로 들어오지만 한 줄만 남는다.
  const idle = terminated('idle.internal.example');
  assert.doesNotThrow(() => { client.emit('error', idle); pool.emit('error', idle, client); });
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines[1]!, /idle\.internal\.example/);
});

test('반복마다 기록된 커서에서 조회 시작 블록을 다시 계산해 처리 전에 게이트웨이에 넘긴다', async () => {
  const calls: string[] = [];
  const starts = [700, 900];
  const runOnce = runWorker.scanRefreshingRunOnce({
    repository: {
      async getEventScanStart(chainId, contractAddress) {
        calls.push(`scan:${chainId}:${contractAddress}`);
        return starts.shift()!;
      },
    },
    gateway: { setScanFromBlock: (block) => { calls.push(`set:${block}`); } },
    worker: { async runOnce(workerId) { calls.push(`run:${workerId}`); return true; } },
    chainId: 84532,
    contractAddress: '0xabc',
    workerId: 'w-1',
  });

  assert.equal(await runOnce(), true);
  // 첫 반복은 시작 때 계산한 값을 쓰므로 다시 계산하지 않는다.
  assert.deepEqual(calls, ['run:w-1']);

  await runOnce();
  await runOnce();
  assert.deepEqual(calls.slice(1), [
    'scan:84532:0xabc', 'set:700', 'run:w-1',
    'scan:84532:0xabc', 'set:900', 'run:w-1',
  ]);
});

test('같은 WORKER_ID여도 호스트 이름과 pid가 붙어 임대 소유자가 프로세스마다 다르다', () => {
  const owner = runWorker.workerLeaseOwner('masscom-mint-worker');
  assert.equal(owner, `masscom-mint-worker-${hostname()}-${process.pid}`);
  assert.equal(runWorker.workerLeaseOwner('  '), `local-mint-worker-${hostname()}-${process.pid}`);
  assert.equal(runWorker.workerLeaseOwner(undefined), `local-mint-worker-${hostname()}-${process.pid}`);
});

test('실행기는 CHAIN_FROM_BLOCK이 비어 있으면 시작하지 않는다(compose는 기본값을 두지 않는다)', async () => {
  const base = {
    DATABASE_URL: 'postgresql://127.0.0.1:1/unused_test',
    CHAIN_RPC_URL: 'http://127.0.0.1:1',
    CHAIN_ID: '84532',
    NFT_CONTRACT_ADDRESS: '0x7000000000000000000000000000000000000007',
    MINTER_ADDRESS: '0x8000000000000000000000000000000000000008',
    NFT_METADATA_ORIGIN: 'https://masscom.kr',
  };
  await assert.rejects(
    runWorker.createConfiguredWorker({ ...base, CHAIN_FROM_BLOCK: '' }),
    /CHAIN_FROM_BLOCK is required/,
  );
});
