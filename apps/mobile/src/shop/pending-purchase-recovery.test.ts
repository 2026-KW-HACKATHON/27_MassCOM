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
    findGrade: (grade) => grade === 'SILVER',
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
    findGrade: () => true,
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
    findGrade: () => true,
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
    findGrade: () => true,
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