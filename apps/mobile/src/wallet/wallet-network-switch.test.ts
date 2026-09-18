import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EthersAdapter } from '@reown/appkit-ethers-react-native';

import { baseSepolia } from './base-sepolia';

test('Reown Ethers adapter switches to Base Sepolia without requesting add-chain permission', async () => {
  const requests: {
    args: { method: string; params?: unknown[] };
    chainId?: string;
  }[] = [];
  let requestError: Error | undefined;

  const provider = {
    on() {},
    off() {},
    async request(args: { method: string; params?: unknown[] }, chainId?: string) {
      requests.push({ args, chainId });
      if (requestError) throw requestError;
      return null;
    },
  };
  const connector = {
    getProvider() {
      return provider;
    },
    getNamespaces() {
      return {};
    },
  };
  const adapter = new EthersAdapter();

  adapter.init({ connector: connector as never });
  await adapter.switchNetwork(baseSepolia);

  assert.deepEqual(requests, [
    {
      args: {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x14a34' }],
      },
      chainId: 'eip155:84532',
    },
  ]);
  assert.equal(requests.some(({ args }) => args.method === 'wallet_addEthereumChain'), false);

  requests.length = 0;
  requestError = Object.assign(new Error('User rejected the request.'), { code: 4001 });
  await assert.rejects(
    adapter.switchNetwork(baseSepolia),
    (error: unknown) => error instanceof Error && error.message === 'Chain is not supported',
  );
  assert.deepEqual(requests.map(({ args }) => args.method), ['wallet_switchEthereumChain']);

  requests.length = 0;
  const unsupportedChain = Object.assign(new Error('Unrecognized chain.'), { code: 4902 });
  requestError = unsupportedChain;
  await assert.rejects(adapter.switchNetwork(baseSepolia), (error: unknown) => error === unsupportedChain);
  assert.deepEqual(requests.map(({ args }) => args.method), ['wallet_switchEthereumChain']);
});
