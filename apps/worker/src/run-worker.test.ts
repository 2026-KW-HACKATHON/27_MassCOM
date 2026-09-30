import assert from 'node:assert/strict';
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
