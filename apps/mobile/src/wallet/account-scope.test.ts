import assert from 'node:assert/strict';
import test from 'node:test';

import { accountStorageTag, purgeForeignWalletSessions, walletSessionPrefix } from './account-scope';

test('D02 storage keys are scoped per account without containing the account ID', () => {
  const prefix = walletSessionPrefix('customer-alice');
  assert.match(prefix, /^@masscom:appkit:[0-9a-f]{8}:$/);
  assert.equal(prefix.includes('alice'), false);
  assert.equal(accountStorageTag('customer-alice'), accountStorageTag('customer-alice'));
  assert.notEqual(walletSessionPrefix('customer-alice'), walletSessionPrefix('customer-bob'));
});

test('D02 switching accounts removes the previous wallet session and keeps the current one', async () => {
  const alice = walletSessionPrefix('customer-alice');
  const bob = walletSessionPrefix('customer-bob');
  const stored = new Set([
    `${alice}wc@2:client:session`,
    `${alice}pairing`,
    `${bob}wc@2:client:session`,
    '@masscom:appkit:legacy-unscoped-session',
    'unrelated:setting',
  ]);

  const removed = await purgeForeignWalletSessions({
    accountId: 'customer-bob',
    listStoredKeys: async () => [...stored],
    removeStoredKeys: async (keys) => {
      for (const key of keys) stored.delete(key);
    },
  });

  assert.equal(removed, 3);
  assert.deepEqual([...stored].sort(), [`${bob}wc@2:client:session`, 'unrelated:setting'].sort());
});

test('D02 nothing is removed when only the current account has a session', async () => {
  const own = `${walletSessionPrefix('customer-alice')}session`;
  let removeCalls = 0;
  const removed = await purgeForeignWalletSessions({
    accountId: 'customer-alice',
    listStoredKeys: async () => [own],
    removeStoredKeys: async () => {
      removeCalls += 1;
    },
  });
  assert.equal(removed, 0);
  assert.equal(removeCalls, 0);
});
