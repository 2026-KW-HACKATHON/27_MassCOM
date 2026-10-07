import assert from 'node:assert/strict';
import { test } from 'node:test';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { coinRerollPendingKey, readCoinRerollPending, writeCoinRerollPending, clearCoinRerollPending } from './coin-reroll-pending';
import { pendingFocusSnapshot } from './pending-focus';

test('a deferred reroll response settling while blurred leaves no stale pending or busy state on refocus', async () => {
  const global = globalThis as unknown as { window?: unknown };
  const previous = global.window;
  const values = new Map<string, string>();
  global.window = { localStorage: {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null, key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { values.set(key, value); },
  } };
  try {
    const key = coinRerollPendingKey('account-1', 'https://api.example.test', 'app');
    const attempt = { ticketId: 'ticket-1', poolId: 'pool-1', requestId: 'same-request', source: {
      sourceKind: 'VISIT' as const, sourceId: 'visit-1', publicationId: 'publication-1', gradeId: 'silver',
      merchantId: 'merchant-1', nftStatus: 'NOT_REQUESTED' as const, rerollEligible: true,
    } };
    await writeCoinRerollPending(key, attempt);
    let finish!: () => void;
    const response = new Promise<void>((resolve) => { finish = resolve; });
    let busy = true;
    const pendingRequest = response.then(async () => { await clearCoinRerollPending(key); busy = false; });
    // The screen blurs before the API responds, so its cached UI state is not settled.
    finish(); await pendingRequest;
    assert.deepEqual(await pendingFocusSnapshot(() => readCoinRerollPending(key), () => busy),
      { pending: undefined, busy: false });

    const ticketUseKey = `${key}:ticket-use`;
    await AsyncStorage.setItem(ticketUseKey, 'draw-ticket-1');
    busy = true;
    assert.deepEqual(await pendingFocusSnapshot(() => AsyncStorage.getItem(ticketUseKey), () => busy),
      { pending: 'draw-ticket-1', busy: true });
    await AsyncStorage.removeItem(ticketUseKey); busy = false;
    assert.deepEqual(await pendingFocusSnapshot(() => AsyncStorage.getItem(ticketUseKey), () => busy),
      { pending: undefined, busy: false });
  } finally { global.window = previous; }
});
