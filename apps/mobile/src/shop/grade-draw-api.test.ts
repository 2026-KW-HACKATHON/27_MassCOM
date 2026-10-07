import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGradeDrawApi, parseGradeDrawResult, parseGradeDrawShop } from './grade-draw-api';
import { ShopApiError } from './shop-api';

const reward = { kind: 'CHARACTER', id: 'cook-cat', name: '요리사 냥이' };
const pool = { grade: 'BRONZE', price: 100, version: 'version-1', total: 1, probabilityPerItem: 1,
  rewards: [reward], counts: { COIN: 0, THEME: 0, CHARACTER: 1 } };
const result = { drawId: 'draw-1', grade: 'BRONZE', price: 100, reward, duplicate: true, quantity: 2, balance: 300, replayed: true };

test('the entire grade pool includes owned items at the disclosed 1/N chance', () => {
  const parsed = parseGradeDrawShop({ balance: 400, pools: [pool], history: [] });
  assert.deepEqual(parsed.pools[0]?.rewards, [reward]);
  assert.equal(parsed.pools[0]?.probabilityPerItem, 1);
  assert.throws(() => parseGradeDrawShop({ balance: 400, pools: [{ ...pool, probabilityPerItem: 0.5 }], history: [] }), ShopApiError);
  assert.throws(() => parseGradeDrawShop({ balance: 400, pools: [{ ...pool, total: 2 }], history: [] }), ShopApiError);
});

test('a replayed duplicate is still one reward with its persisted quantity', () => {
  assert.deepEqual(parseGradeDrawResult(result), result);
  assert.throws(() => parseGradeDrawResult({ ...result, quantity: 0 }), ShopApiError);
  assert.throws(() => parseGradeDrawResult({ ...result, reward: { kind: 'COIN', id: 'fake', name: 'fake' } }), ShopApiError);
});

test('draw uses the same UUID and pool version on the authenticated endpoint', async () => {
  const calls: { url: string; body: unknown; authorization: string | null }[] = [];
  const api = createGradeDrawApi({ apiUrl: 'https://api.example.test/', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, authorization: headers.get('authorization') });
      return Response.json(init?.method === 'POST' ? result : { balance: 400, pools: [pool], history: [] });
    } });
  await api.getShop();
  assert.deepEqual(await api.draw({ grade: 'BRONZE', requestId: 'same-id', expectedPoolVersion: 'version-1' }), result);
  assert.equal(calls[0]?.url, 'https://api.example.test/shop/draw-pools');
  assert.deepEqual(calls[1], { url: 'https://api.example.test/shop/draws', authorization: 'Bearer session',
    body: { grade: 'BRONZE', requestId: 'same-id', expectedPoolVersion: 'version-1' } });
});
