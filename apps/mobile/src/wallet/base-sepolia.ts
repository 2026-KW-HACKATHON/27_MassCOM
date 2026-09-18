import type { AppKitNetwork } from '@reown/appkit-react-native';

export const baseSepolia = {
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://sepolia.base.org'],
    },
  },
  blockExplorers: {
    default: {
      name: 'BaseScan',
      url: 'https://sepolia.basescan.org',
    },
  },
  chainNamespace: 'eip155',
  caipNetworkId: 'eip155:84532',
  testnet: true,
} as const satisfies AppKitNetwork;
