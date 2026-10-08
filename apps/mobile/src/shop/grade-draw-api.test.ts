import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGradeDrawApi, parseGradeDrawResult, parseGradeDrawShop } from './grade-draw-api';
import { ShopApiError } from './shop-api';

const reward = { kind: 'CHARACTER', id: 'cook-cat', name: '요리사 냥이' };
const pool = { grade: 'BRONZE', price: 100, version: 'version-1', total: 1,
  rewards: [{ rarity: 'BRONZE', reward: { kind: 'MILEAGE', id: 'mileage-bronze', name: '20P', amount: 20 }, probability: 1 }],
  gradeWeights: { BRONZE: 10000 }, categoryWeightsByRarity: { BRONZE: { MILEAGE: 10000, FURNITURE: 0, THEME: 0, REROLL_TICKET: 0 } } };
const result = { drawId: 'draw-1', grade: 'BRONZE', rarity: 'BRONZE', price: 100, reward, duplicate: true, quantity: 2, balance: 300, replayed: true };

test('the weighted pool exposes each reward chance and rejects invalid totals', () => {
  const parsed = parseGradeDrawShop({ balance: 400, pools: [pool], history: [] });
  assert.deepEqual(parsed.pools[0]?.rewards, pool.rewards);
  assert.equal(parsed.pools[0]?.rewards[0]?.probability, 1);
  assert.throws(() => parseGradeDrawShop({ balance: 400, pools: [{ ...pool, rewards: [{ ...pool.rewards[0], probability: 0.5 }] }], history: [] }), ShopApiError);
  assert.throws(() => parseGradeDrawShop({ balance: 400, pools: [{ ...pool, total: 2 }], history: [] }), ShopApiError);
});

test('new reward kinds parse while historical coin and character draws remain readable', () => {
  const history = [{ drawId: 'old', grade: 'BRONZE', rarity: null, price: 100, reward, createdAt: '2026-01-01T00:00:00Z' }];
  assert.equal(parseGradeDrawShop({ balance: 400, pools: [pool], history }).history[0]?.rarity, null);
  assert.equal(parseGradeDrawResult({ ...result, rarity: null }).rarity, null);
  assert.equal(parseGradeDrawResult({ ...result, reward: { kind: 'REROLL_TICKET', id: 'reroll-bronze', name: '브론즈 리롤권', grade: 'BRONZE' } }).reward.kind, 'REROLL_TICKET');
  assert.equal(parseGradeDrawResult({ ...result, reward: { kind: 'FURNITURE', id: 'chair', name: '의자', assetId: 'oak-chair' } }).reward.kind, 'FURNITURE');
  assert.throws(() => parseGradeDrawResult({ ...result, reward: { kind: 'FURNITURE', id: 'chair', name: '의자' } }), ShopApiError);
});

test('a replayed duplicate is still one reward with its persisted quantity', () => {
  assert.deepEqual(parseGradeDrawResult(result), result);
  assert.throws(() => parseGradeDrawResult({ ...result, quantity: 0 }), ShopApiError);
  assert.throws(() => parseGradeDrawResult({ ...result, reward: { kind: 'COIN', id: 'fake', name: 'fake' } }), ShopApiError);
});

test('visit reversal debt still allows the shop pool and history to load', () => {
  assert.equal(parseGradeDrawShop({ balance: -90, pools: [pool], history: [] }).balance, -90);
  for (const balance of [-0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseGradeDrawShop({ balance, pools: [pool], history: [] }), ShopApiError);
  }
  assert.throws(() => parseGradeDrawShop({ balance: -90, pools: [{ ...pool, price: -100 }], history: [] }), ShopApiError);
});

test('an already charged draw can replay after a reversal makes the balance negative', () => {
  assert.deepEqual(parseGradeDrawResult({ ...result, balance: -90 }), { ...result, balance: -90 });
  for (const balance of [-0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseGradeDrawResult({ ...result, balance }), ShopApiError);
  }
  assert.throws(() => parseGradeDrawResult({ ...result, balance: -90, quantity: -1 }), ShopApiError);
  assert.throws(() => parseGradeDrawResult({ ...result, balance: -90, price: -100 }), ShopApiError);
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

test('draw stops waiting when the response body never finishes', async () => {
  const requestIds: string[] = [];
  const api = createGradeDrawApi({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    timeoutMs: 10, fetcher: async (_, init) => {
      requestIds.push(JSON.parse(String(init?.body)).requestId);
      return requestIds.length === 1 ? ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as Response : Response.json(result);
    } });
  const attempt = { grade: 'BRONZE' as const, requestId: 'same-id', expectedPoolVersion: 'version-1' };
  await assert.rejects(api.draw(attempt),
    (error: unknown) => error instanceof ShopApiError && error.code === 'REQUEST_TIMEOUT');
  assert.deepEqual(await api.draw(attempt), result);
  assert.deepEqual(requestIds, ['same-id', 'same-id']);
});
