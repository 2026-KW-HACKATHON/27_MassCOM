import assert from 'node:assert/strict';
import { test } from 'node:test';

import { clearCoinRerollPending, coinRerollPendingKey, readCoinRerollPending, startOrResumeCoinReroll, writeCoinRerollPending } from './coin-reroll-pending';
import { clearFurniturePending, furniturePendingKey, readFurniturePending, writeFurniturePending } from './furniture-pending';

test('isolated pending purchases and a committed reroll with lost response reuse their original request IDs', async () => {
  const testGlobal = globalThis as unknown as { window?: unknown };
  const before = testGlobal.window;
  const values = new Map<string, string>();
  testGlobal.window = { localStorage: {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null, key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { values.set(key, value); },
  } };
  try {
    const coinKey = coinRerollPendingKey('one', 'https://api.example.test', 'app');
    const furnitureKey = furniturePendingKey('one', 'https://api.example.test', 'app');
    const reroll = { ticketId: 'ticket-1', poolId: 'pool-1', requestId: 'stable-reroll', source: {
      sourceKind: 'VISIT' as const, sourceId: 'visit-1', publicationId: 'publication-1', gradeId: 'silver',
      merchantId: 'merchant-1', nftStatus: 'NOT_REQUESTED' as const, rerollEligible: true,
    } };
    const furniture = { itemId: 'sofa-1', requestId: 'stable-furniture' };
    await writeCoinRerollPending(coinKey, reroll);
    await writeFurniturePending(furnitureKey, furniture);
    assert.deepEqual(await readCoinRerollPending(coinKey), reroll);
    assert.deepEqual(await readFurniturePending(furnitureKey), furniture);
    assert.equal(await readCoinRerollPending(coinRerollPendingKey('two', 'https://api.example.test', 'app')), null);
    assert.equal(await readFurniturePending(furniturePendingKey('one', 'https://api.example.test', 'demo')), null);
    await clearCoinRerollPending(coinKey); await clearFurniturePending(furnitureKey);
    assert.equal(await readCoinRerollPending(coinKey), null);
    assert.equal(await readFurniturePending(furnitureKey), null);

    const original = await startOrResumeCoinReroll(coinKey, () => reroll);
    assert.deepEqual(original, reroll);
    let respond!: () => void;
    const delayed = new Promise<void>((resolve) => { respond = resolve; });
    const committed = new Map<string, string>();
    const firstResponse = delayed.then(() => {
      committed.set(original!.requestId, 'result-1');
      throw new Error('response lost');
    });
    respond();
    await assert.rejects(firstResponse, /response lost/);
    let createdSecond = false;
    const confirmedAgain = await startOrResumeCoinReroll(coinKey, () => {
      createdSecond = true;
      return { ...reroll, requestId: 'dangerous-new-request' };
    });
    assert.equal(createdSecond, false);
    assert.equal(confirmedAgain?.requestId, original?.requestId);
    assert.equal(committed.get(confirmedAgain!.requestId), 'result-1');
    await clearCoinRerollPending(coinKey);
  } finally { testGlobal.window = before; }
});
