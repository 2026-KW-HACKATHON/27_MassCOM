import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShopRerollResult } from './shop-api';
import { recoverPendingPurchase } from './pending-purchase-recovery';
import type { PendingPurchaseScope, StoredPendingPurchase } from './pending-purchase-storage';

const scope: PendingPurchaseScope = { accountId: 'acct-1', apiUrl: 'https://api.example.test', appVariant: 'kr.masscom.app' };
const pending: StoredPendingPurchase = { grade: 'SILVER', requestId: 'request-1', expectedRemaining: 2 };
const result: ShopRerollResult = {
  item: { id: 'friend-1', grade: 'SILVER', name: '은빛 친구' },
  balance: 310,
  replayed: true,
  rewards: {
    mileage: { amount: 24, min: 10, max: 50, probabilityPerAmount: 1 / 41 },
    clothing: { awarded: false, duplicate: false, item: null, probability: 0.5 },
    sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'],
  },
};

test('pending recovery replays one stored request across slow state updates and releases busy on success', async () => {
  const events: string[] = [];
  let rerollCalls = 0;
  let release!: (value: ShopRerollResult) => void;
  const replay = new Promise<ShopRerollResult>((resolve) => { release = resolve; });
  const run = recoverPendingPurchase({
    scope,
    readPending: async () => pending,
    clearPending: async () => { events.push('clear'); },
    reroll: async (input) => { rerollCalls += 1; events.push(`post:${input.grade}:${input.requestId}:${input.expectedRemaining}`); return replay; },
    isCurrent: () => true,
    onStart: (stored) => { events.push(`busy:${stored.grade}`); },
    onSuccess: (next) => { events.push(`success:${next.item.id}`); },
    onError: () => { events.push('error'); },
    onFinish: () => { events.push('idle'); },
  });
  await Promise.resolve();
  events.push('rerender-busy-state-update');
  release(result);
  assert.equal(await run, 'success');
  assert.equal(rerollCalls, 1);
  assert.deepEqual(events, ['busy:SILVER', 'post:SILVER:request-1:2', 'rerender-busy-state-update', 'clear', 'success:friend-1', 'idle']);
});

test('pending recovery reports errors without clearing storage and still releases busy', async () => {
  const events: string[] = [];
  const status = await recoverPendingPurchase({
    scope,
    readPending: async () => pending,
    clearPending: async () => { events.push('clear'); },
    reroll: async () => { throw new Error('network'); },
    isCurrent: () => true,
    onStart: () => { events.push('busy'); },
    onSuccess: () => { events.push('success'); },
    onError: (error) => { events.push(error instanceof Error ? error.message : 'error'); },
    onFinish: () => { events.push('idle'); },
  });
  assert.equal(status, 'error');
  assert.deepEqual(events, ['busy', 'network', 'idle']);
});

test('pending recovery ignores stale account switches before POST', async () => {
  const events: string[] = [];
  const status = await recoverPendingPurchase({
    scope,
    readPending: async () => pending,
    clearPending: async () => { events.push('clear'); },
    reroll: async () => { events.push('post'); return result; },
    isCurrent: () => false,
    onStart: () => { events.push('busy'); },
    onSuccess: () => { events.push('success'); },
    onError: () => { events.push('error'); },
    onFinish: () => { events.push('idle'); },
  });
  assert.equal(status, 'stale');
  assert.deepEqual(events, []);
});

test('pending recovery reports storage read failures without posting and releases caller flow', async () => {
  const events: string[] = [];
  const status = await recoverPendingPurchase({
    scope,
    readPending: async () => { throw new Error('storage unavailable'); },
    clearPending: async () => { events.push('clear'); },
    reroll: async () => { events.push('post'); return result; },
    isCurrent: () => true,
    onStart: () => { events.push('busy'); },
    onSuccess: () => { events.push('success'); },
    onError: (error) => { events.push(error instanceof Error ? error.message : 'error'); },
    onFinish: () => { events.push('idle'); },
  });
  assert.equal(status, 'error');
  assert.deepEqual(events, ['storage unavailable']);
});
test('a lost response for the last item is replayed from storage even when refreshed purchases are unavailable', async () => {
  let stored: StoredPendingPurchase | null = pending;
  const posts: string[] = [];
  let successes = 0;
  const cached = { balance: 0, grades: [], lastItemOwned: true };
  assert.equal(cached.balance < 200 && cached.lastItemOwned, true);
  const deps = {
    scope, readPending: async () => stored,
    clearPending: async () => { stored = null; },
    reroll: async (input: { requestId: string }) => { posts.push(input.requestId); return result; },
    isCurrent: () => true, onStart: () => {}, onSuccess: () => { successes += 1; }, onError: () => {}, onFinish: () => {},
  };
  assert.equal(await recoverPendingPurchase(deps), 'success');
  assert.equal(await recoverPendingPurchase(deps), 'empty');
  assert.deepEqual(posts, ['request-1']);
  assert.equal(successes, 1);
});

test('an account switch while clearing a recovered request cannot publish its result to the next account', async () => {
  let current = true;
  let applied = false;
  const status = await recoverPendingPurchase({
    scope, readPending: async () => pending,
    clearPending: async () => { current = false; },
    reroll: async () => result,
    isCurrent: () => current, onStart: () => {}, onSuccess: () => { applied = true; }, onError: () => {}, onFinish: () => {},
  });
  assert.equal(status, 'stale');
  assert.equal(applied, false);
});


test('recovery uses the stored request for a cached last-owned item and an insufficient balance without debiting again', async () => {
  let stored: StoredPendingPurchase | null = pending;
  let balance = 0;
  let applied = 0;
  const ledger = new Map([[pending.requestId, result]]);
  const cachedGrade = { remaining: 0, owned: 3, total: 3, price: 200 };
  assert.equal(balance >= cachedGrade.price && cachedGrade.remaining > 0, false);
  const deps = {
    scope, readPending: async () => stored,
    clearPending: async () => { stored = null; },
    reroll: async (input: { requestId: string; expectedRemaining: number }) => {
      assert.equal(input.requestId, pending.requestId);
      assert.equal(input.expectedRemaining, pending.expectedRemaining, 'replay keeps original optimistic state');
      const replay = ledger.get(input.requestId);
      if (replay) return replay;
      balance -= cachedGrade.price;
      throw new Error('unexpected fresh purchase');
    },
    isCurrent: () => true, onStart: () => {}, onSuccess: () => { applied += 1; }, onError: () => {}, onFinish: () => {},
  };
  assert.equal(await recoverPendingPurchase(deps), 'success');
  assert.equal(await recoverPendingPurchase(deps), 'empty');
  assert.equal(balance, 0, 'the replay adds no second debit');
  assert.equal(applied, 1, 'the recovered result is published once');
});

test('a response arriving after account switch keeps the old request recoverable without changing the new view', async () => {
  let current = true;
  const events: string[] = [];
  const status = await recoverPendingPurchase({
    scope, readPending: async () => pending,
    clearPending: async () => { events.push('clear'); },
    reroll: async () => { current = false; return result; },
    isCurrent: () => current, onStart: () => { events.push('start'); },
    onSuccess: () => { events.push('success'); }, onError: () => { events.push('error'); }, onFinish: () => { events.push('finish'); },
  });
  assert.equal(status, 'stale');
  assert.deepEqual(events, ['start']);
});
