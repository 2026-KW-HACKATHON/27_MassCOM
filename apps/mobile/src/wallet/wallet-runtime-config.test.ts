import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getWalletRuntimeConfig } from './wallet-runtime-config';

test('keeps wallet linking unavailable until a Reown project ID and API URL are configured', () => {
  const config = getWalletRuntimeConfig({});

  assert.deepEqual(config, {
    available: false,
    missing: [
      'EXPO_PUBLIC_REOWN_PROJECT_ID',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
    ],
  });
});

test('returns the fixed Base Sepolia and external-wallet-only feature contract', () => {
  const config = getWalletRuntimeConfig({
    EXPO_PUBLIC_REOWN_PROJECT_ID: 'project-test-123',
    EXPO_PUBLIC_API_URL: 'https://api.example.test',
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'demo-user-1',
  });

  assert.equal(config.available, true);
  if (!config.available) return;

  assert.equal(config.projectId, 'project-test-123');
  assert.equal(config.apiUrl, 'https://api.example.test');
  assert.equal(config.accountId, 'demo-user-1');
  assert.equal(config.chainId, 84532);
  assert.equal(config.caipNetworkId, 'eip155:84532');
  assert.deepEqual(config.features, {
    socials: false,
    swaps: false,
    onramp: false,
    showWallets: true,
  });
  assert.equal(config.enableAnalytics, false);
  assert.deepEqual(config.sessionPermissions, {
    methods: {
      eip155: [
        'eth_requestAccounts',
        'eth_accounts',
        'eth_chainId',
        'wallet_switchEthereumChain',
        'personal_sign',
      ],
    },
    chains: {
      eip155: ['eip155:84532'],
    },
    events: {
      eip155: ['accountsChanged', 'chainChanged', 'disconnect'],
    },
    rpcMap: {
      'eip155:84532': 'https://sepolia.base.org',
    },
  });
});

test('rejects non-HTTPS production-like API URLs', () => {
  assert.throws(() =>
    getWalletRuntimeConfig({
      EXPO_PUBLIC_REOWN_PROJECT_ID: 'project-test-123',
      EXPO_PUBLIC_API_URL: 'http://api.example.test',
      EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'demo-user-1',
    }),
  );
});

test('allows loopback HTTP only for local development', () => {
  const config = getWalletRuntimeConfig({
    EXPO_PUBLIC_REOWN_PROJECT_ID: 'project-test-123',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'demo-user-1',
  });

  assert.equal(config.available, true);
});
