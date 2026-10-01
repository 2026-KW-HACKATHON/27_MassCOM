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

// PR #312 리뷰 2번: 구매·대표 설정이 확정한 상태를, 그보다 먼저 시작해 아직 끝나지 않은 GET /shop 응답이 뒤늦게
// 덮어써서는 안 된다(재현: 400P·남은 2종 → 뒤늦은 GET이 500P·남은 3종으로 되돌림).
test('applyReroll invalidates an in-flight getShop so its late answer cannot overwrite the confirmed purchase', async () => {
  const states: unknown[] = [];
  let resolveGet: (value: ShopSnapshot) => void = () => {};
  const api = { getShop: () => new Promise<ShopSnapshot>((resolve) => { resolveGet = resolve; }) };
  const loader = createShopLoader(api, (update) => states.push(update(states.at(-1) as never ?? initialShopLoad)));
  states.push(loaded(snapshot()));
  const pendingGet = loader.load(true);
  loader.applyReroll({ item: { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' }, balance: 300, replayed: false });
  resolveGet(snapshot()); // 재뽑기 전의 낡은 스냅샷(400P·남은 2종)이 뒤늦게 돌아온다.
  await pendingGet;
  const last = states.at(-1) as { snapshot?: ShopSnapshot };
  assert.equal(last.snapshot?.mileage.balance, 300, '낡은 GET이 확정된 잔액을 되돌리면 안 된다');
  assert.equal(last.snapshot?.grades[0]!.remaining, 1, '낡은 GET이 확정된 남은 수를 되돌리면 안 된다');
});

test('applyAvatar also invalidates an in-flight getShop so its late answer cannot overwrite the confirmed avatar', async () => {
  const states: unknown[] = [];
  let resolveGet: (value: ShopSnapshot) => void = () => {};
  const api = { getShop: () => new Promise<ShopSnapshot>((resolve) => { resolveGet = resolve; }) };
  const loader = createShopLoader(api, (update) => states.push(update(states.at(-1) as never ?? initialShopLoad)));
  states.push(loaded(snapshot({ avatar: 'cook-cat' })));
  const pendingGet = loader.load(true);
  loader.applyAvatar('cafe-bear');
  resolveGet(snapshot({ avatar: 'cook-cat' })); // 바꾸기 전의 낡은 대표 캐릭터가 뒤늦게 돌아온다.
  await pendingGet;
  assert.equal((states.at(-1) as { snapshot?: ShopSnapshot }).snapshot?.avatar, 'cafe-bear');
});

// PR #312 리뷰 3번: dispose() 뒤(세션 만료로 화면이 다시 마운트되는 동안 등) 뒤늦게 끝난 호출이 사라진 화면에
// setState하면 안 된다.
test('applyReroll and applyAvatar do nothing after dispose', () => {
  const states: unknown[] = [];
  const api = { getShop: async () => snapshot() };
  const loader = createShopLoader(api, (update) => states.push(update(states.at(-1) as never ?? initialShopLoad)));
  states.push(loaded(snapshot()));
  loader.dispose();
  loader.applyReroll({ item: { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' }, balance: 300, replayed: false });
  loader.applyAvatar('cafe-bear');
  assert.equal(states.length, 1, 'no update must be applied after dispose');
});
