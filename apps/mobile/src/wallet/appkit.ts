import '@walletconnect/react-native-compat';

import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { createAppKit } from '@reown/appkit-react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { walletSessionPrefix } from './account-scope';
import { createAppKitStorage } from './appkit-storage';
import { baseSepolia } from './base-sepolia';
import { getWalletRuntimeConfig } from './wallet-runtime-config';

export const walletRuntimeConfig = getWalletRuntimeConfig({
  EXPO_PUBLIC_REOWN_PROJECT_ID: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

// The wallet returns to whichever variant is installed. If the embedded config is missing, the
// installed package decides, so the store app never advertises the development scheme.
const configuredScheme = Constants.expoConfig?.scheme;
const appScheme =
  (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) ??
  (Application.applicationId === 'kr.masscom.wolgye' ? 'masscom' : 'masscom-dev');

export function createAccountScopedAppKit(
  config: typeof walletRuntimeConfig,
  accountId: string,
) {
  const normalizedAccountId = accountId.trim();
  return config.available && normalizedAccountId
    ? createAppKit({
      projectId: config.projectId,
      metadata: {
        name: 'Wolgye Mascot',
        description: 'Restaurant visit verification and mascot collection',
        url: 'https://github.com/2026-KW-HACKATHON/27_MassCOM',
        icons: [],
        redirect: {
          native: `${appScheme}://wallet`,
        },
      },
      adapters: [new EthersAdapter()],
      networks: [baseSepolia],
      defaultNetwork: baseSepolia,
      // Scoped per account, so another account's wallet session is never read back. The account
      // is fixed for the life of the process: WalletConnect caches its storage on a process-wide
      // core, so a runtime login must recreate AppKit with its own `customStoragePrefix` (or
      // restart the app) before it may change accounts.
      storage: createAppKitStorage(walletSessionPrefix(normalizedAccountId)),
      features: config.features,
      universalProviderConfigOverride: config.sessionPermissions,
      enableAnalytics: config.enableAnalytics,
      debug: __DEV__,
      logger: __DEV__ ? 'warn' : 'error',
    })
    : null;
}
