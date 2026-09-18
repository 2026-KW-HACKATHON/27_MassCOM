import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertAllowedWalletMethod,
  buildPersonalSignRequest,
  safeWalletRequest,
  WalletMethodNotAllowedError,
} from './wallet-method-policy';

test('allows only account, Base network correction, and readable message-signing methods', () => {
  const allowed = [
    'eth_requestAccounts',
    'eth_accounts',
    'eth_chainId',
    'wallet_switchEthereumChain',
    'personal_sign',
  ];

  for (const method of allowed) {
    assert.doesNotThrow(() => assertAllowedWalletMethod(method));
  }
});

test('rejects transaction, approval, typed-data, and batch-call methods', () => {
  const denied = [
    'eth_sendTransaction',
    'eth_signTransaction',
    'wallet_sendCalls',
    'eth_signTypedData',
    'eth_signTypedData_v4',
    'wallet_addEthereumChain',
    'wallet_getCapabilities',
  ];

  for (const method of denied) {
    assert.throws(
      () => assertAllowedWalletMethod(method),
      (error: unknown) =>
        error instanceof WalletMethodNotAllowedError &&
        error.code === 'WALLET_METHOD_NOT_ALLOWED' &&
        error.method === method,
    );
  }
});

test('rejects unknown wallet methods by default', () => {
  assert.throws(
    () => assertAllowedWalletMethod('wallet_future_risky_method'),
    (error: unknown) => error instanceof WalletMethodNotAllowedError,
  );
});

test('forwards allowed requests and blocks denied methods before the provider sees them', async () => {
  const receivedMethods: string[] = [];
  const provider = {
    async request<T>({ method }: { method: string }): Promise<T> {
      receivedMethods.push(method);
      return '0x14a34' as T;
    },
  };

  const chainId = await safeWalletRequest<string>(provider, { method: 'eth_chainId' });
  assert.equal(chainId, '0x14a34');
  assert.deepEqual(receivedMethods, ['eth_chainId']);

  await assert.rejects(
    safeWalletRequest(provider, { method: 'eth_sendTransaction', params: [] }),
    (error: unknown) => error instanceof WalletMethodNotAllowedError,
  );
  assert.deepEqual(receivedMethods, ['eth_chainId']);
});

test('builds a personal_sign request with a readable UTF-8 message and no transaction payload', () => {
  assert.deepEqual(
    buildPersonalSignRequest('Verify wallet', '0x0000000000000000000000000000000000000001'),
    {
      method: 'personal_sign',
      params: [
        '0x5665726966792077616c6c6574',
        '0x0000000000000000000000000000000000000001',
      ],
    },
  );
});
