import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EthersAdapter } from '@reown/appkit-ethers-react-native';

import { baseSepolia } from './base-sepolia';

test('Reown Ethers adapter switches to Base Sepolia without requesting add-chain permission', async () => {
  const requests: {
    args: { method: string; params?: unknown[] };
    chainId?: string;
  }[] = [];

  const provider = {
    on() {},
    off() {},
    async request(args: { method: string; params?: unknown[] }, chainId?: string) {
      requests.push({ args, chainId });
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
});
