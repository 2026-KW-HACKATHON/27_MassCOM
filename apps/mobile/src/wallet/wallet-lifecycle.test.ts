import assert from 'node:assert/strict';
import test from 'node:test';

test('cancels the pending connection before closing the wallet modal', async () => {
  const lifecycle = await import('./wallet-lifecycle').catch(() => undefined);
  assert.ok(lifecycle, 'wallet lifecycle cleanup must exist');

  const calls: string[] = [];
  await lifecycle.cleanupPendingWalletConnection({
    cancelPendingConnection: async () => {
      calls.push('cancel');
    },
    close: async () => {
      calls.push('close');
    },
  });

  assert.deepEqual(calls, ['cancel', 'close']);
});

test('still closes the wallet modal when pending cancellation fails', async () => {
  const lifecycle = await import('./wallet-lifecycle').catch(() => undefined);
  assert.ok(lifecycle, 'wallet lifecycle cleanup must exist');

  let closed = false;
  await lifecycle.cleanupPendingWalletConnection({
    cancelPendingConnection: async () => {
      throw new Error('cancel failed');
    },
    close: async () => {
      closed = true;
    },
  });

  assert.equal(closed, true);
});
