import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShopSnapshot } from './shop-api';
import { createShopLoader, failed, initialShopLoad, loaded, withAvatar, withReroll } from './shop-loader';

function snapshot(overrides: Partial<ShopSnapshot> = {}): ShopSnapshot {
  return {
    mileage: { earned: 500, spent: 100, balance: 400, rules: { visit: 50, newStore: 100, series: 200 } },
    grades: [{ grade: 'BRONZE', price: 100, total: 3, owned: 1, remaining: 2, probabilityPerItem: 0.5 }],
    items: [
      { id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이', owned: true },
      { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이', owned: false },
    ],
    avatar: null,
    ...overrides,
  };
}

test('loaded replaces the snapshot and clears any error', () => {
  const next = snapshot();
  assert.deepEqual(loaded(next), { snapshot: next, status: 'ready', error: undefined });
});

test('a quiet failure after a ready snapshot keeps showing it', () => {
  const state = loaded(snapshot());
  const next = failed(state, new Error('boom'), true);
  assert.equal(next.status, 'ready');
  assert.equal(next.snapshot, state.snapshot);
});

test('a loud failure (first load or retry) becomes an error state', () => {
  assert.equal(failed(initialShopLoad, new Error('boom'), false).status, 'error');
  assert.equal(failed(loaded(snapshot()), new Error('boom'), false).status, 'error');
});

test('withReroll marks the drawn item owned, shrinks remaining and sets the server balance', () => {
  const state = loaded(snapshot());
  const next = withReroll(state, { item: { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' }, balance: 300, replayed: false });
  assert.equal(next.snapshot!.items.find((item) => item.id === 'cafe-bear')!.owned, true);
  assert.deepEqual(next.snapshot!.grades[0], { grade: 'BRONZE', price: 100, total: 3, owned: 2, remaining: 1, probabilityPerItem: 1 });
  assert.equal(next.snapshot!.mileage.balance, 300);
});

test('withReroll on a replayed (already-owned) item does not double-count the grade', () => {
  const state = loaded(snapshot());
  const next = withReroll(state, { item: { id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이' }, balance: 400, replayed: true });
  assert.deepEqual(next.snapshot!.grades[0], state.snapshot!.grades[0]);
  assert.equal(next.snapshot!.mileage.balance, 400);
});

test('withReroll grading to a fully complete grade reports null probability', () => {
  const state = loaded(snapshot({ grades: [{ grade: 'BRONZE', price: 100, total: 2, owned: 1, remaining: 1, probabilityPerItem: 1 }] }));
  const next = withReroll(state, { item: { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' }, balance: 300, replayed: false });
  assert.deepEqual(next.snapshot!.grades[0], { grade: 'BRONZE', price: 100, total: 2, owned: 2, remaining: 0, probabilityPerItem: null });
});

test('withAvatar sets the chosen character without touching anything else', () => {
  const state = loaded(snapshot());
  assert.equal(withAvatar(state, 'cook-cat').snapshot!.avatar, 'cook-cat');
  assert.equal(withAvatar(initialShopLoad, 'cook-cat'), initialShopLoad, 'no snapshot yet: nothing to update');
});

test('createShopLoader applies only the newest answer and ignores a stale one that resolves late', async () => {
  const states: unknown[] = [];
  let resolveFirst: (value: ShopSnapshot) => void = () => {};
  let calls = 0;
  const api = {
    getShop: () => new Promise<ShopSnapshot>((resolve) => {
      calls += 1;
      if (calls === 1) resolveFirst = resolve;
      else resolve(snapshot({ avatar: 'cafe-bear' }));
    }),
  };
  const loader = createShopLoader(api, (update) => states.push(update(states.at(-1) as never ?? initialShopLoad)));
  const firstLoad = loader.load(false);
  const secondLoad = loader.load(false);
  await secondLoad;
  resolveFirst(snapshot({ avatar: 'cook-cat' }));
  await firstLoad;
  const last = states.at(-1) as { snapshot?: ShopSnapshot };
  assert.equal(last.snapshot?.avatar, 'cafe-bear', 'the stale first request must not overwrite the newer answer');
});

test('createShopLoader reports a failure for the latest request only', async () => {
  const states: unknown[] = [];
  const api = { getShop: async () => { throw new Error('down'); } };
  const loader = createShopLoader(api, (update) => states.push(update(states.at(-1) as never ?? initialShopLoad)));
  await loader.load(false);
  assert.equal((states.at(-1) as { status: string }).status, 'error');
});
