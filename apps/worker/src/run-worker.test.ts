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
