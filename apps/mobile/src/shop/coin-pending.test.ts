import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearCoinPending, coinPendingKey, readCoinPending, writeCoinPending } from './coin-pending';

test('lost purchase response retains one request across reload while account and app keys stay separate', async () => {
  const first = coinPendingKey('account-1', 'https://api.example.test/v1', 'app');
  assert.equal(first, coinPendingKey('account-1', 'https://api.example.test/other', 'app'));
  assert.notEqual(first, coinPendingKey('account-2', 'https://api.example.test/v1', 'app'));
  assert.notEqual(first, coinPendingKey('account-1', 'https://api.example.test/v1', 'demo'));
  const testGlobal = globalThis as unknown as { window?: unknown };
  const before = testGlobal.window;
  const values = new Map<string, string>();
  testGlobal.window = { localStorage: {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null, key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { values.set(key, value); },
  } };
  try {
    const attempt = { poolId: 'pool-1', requestId: 'one-request' };
    await writeCoinPending(first, attempt);
    assert.deepEqual(await readCoinPending(first), attempt);
    assert.deepEqual(await readCoinPending(coinPendingKey('account-1', 'https://api.example.test/other', 'app')), attempt);
    assert.equal(await readCoinPending(coinPendingKey('account-2', 'https://api.example.test/v1', 'app')), null);
    await clearCoinPending(first);
    assert.equal(await readCoinPending(first), null);
  } finally { testGlobal.window = before; }
});
