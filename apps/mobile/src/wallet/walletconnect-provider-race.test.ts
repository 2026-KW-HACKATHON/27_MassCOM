import assert from 'node:assert/strict';
import { test } from 'node:test';

import WalletConnectUniversalProvider from '@walletconnect/universal-provider';

type RaceTestProvider = {
  namespaces: Record<string, unknown>;
  session: Record<string, unknown>;
  persist: () => Promise<void>;
  onChainChanged: (input: { currentCaipChainId: string }) => Promise<void>;
};

test('ignores a chain change emitted before the WalletConnect sub-provider is ready', async () => {
  const provider = new WalletConnectUniversalProvider({
    logger: 'silent',
  }) as unknown as RaceTestProvider;

  provider.namespaces = {
    eip155: {
      chains: ['eip155:84532'],
      methods: [],
      events: ['chainChanged'],
      defaultChain: '84532',
    },
  };
  provider.session = {
    topic: 'startup-race-test',
    namespaces: {
      eip155: {
        accounts: ['eip155:84532:0x0000000000000000000000000000000000000001'],
        chains: ['eip155:84532'],
        methods: [],
        events: ['chainChanged'],
      },
    },
  };
  provider.persist = async () => undefined;

  await assert.doesNotReject(() =>
    provider.onChainChanged({ currentCaipChainId: 'eip155:84532' }),
  );
});
