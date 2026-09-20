import assert from 'node:assert/strict';
import test from 'node:test';

import { forgetWalletSession } from './forget-wallet-session';

test('removes every stored wallet session key even when the relay disconnect fails', async () => {
  const stored = new Set(['@masscom:appkit:session', '@masscom:appkit:pairing']);
  await forgetWalletSession({
    disconnect: async () => {
      throw new Error('relay unreachable');
    },
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async (keys) => {
      for (const key of keys) stored.delete(key);
    },
  });
  assert.equal(stored.size, 0);
});

test('disconnects before clearing so the session is not written back', async () => {
  const calls: string[] = [];
  await forgetWalletSession({
    disconnect: async () => {
      calls.push('disconnect');
    },
    listStoredKeys: async () => {
      calls.push('list');
      return [];
    },
    removeStoredKeys: async () => {
      calls.push('remove');
    },
  });
  assert.deepEqual(calls, ['disconnect', 'list']);
});
