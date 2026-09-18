import '@walletconnect/react-native-compat';

import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { createAppKit } from '@reown/appkit-react-native';

import { appKitStorage } from './appkit-storage';
import { baseSepolia } from './base-sepolia';
import { getWalletRuntimeConfig } from './wallet-runtime-config';

export const walletRuntimeConfig = getWalletRuntimeConfig({
  EXPO_PUBLIC_REOWN_PROJECT_ID: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_DEMO_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ID,
});

export const appKit = walletRuntimeConfig.available
  ? createAppKit({
      projectId: walletRuntimeConfig.projectId,
      metadata: {
        name: 'Wolgye Mascot',
        description: 'Restaurant visit verification and mascot collection',
        url: 'https://github.com/2026-KW-HACKATHON/27_MassCOM',
        icons: [],
        redirect: {
          native: 'masscom-dev://',
        },
      },
      adapters: [new EthersAdapter()],
      networks: [baseSepolia],
      defaultNetwork: baseSepolia,
      storage: appKitStorage,
      features: walletRuntimeConfig.features,
      universalProviderConfigOverride: walletRuntimeConfig.sessionPermissions,
      enableAnalytics: walletRuntimeConfig.enableAnalytics,
      debug: __DEV__,
      logger: __DEV__ ? 'warn' : 'error',
      themeMode: 'light',
    })
  : null;
