import '@walletconnect/react-native-compat';

import { EthersAdapter } from '@reown/appkit-ethers-react-native';
import { createAppKit } from '@reown/appkit-react-native';
import Constants from 'expo-constants';

import { walletSessionPrefix } from './account-scope';
import { createAppKitStorage } from './appkit-storage';
import { baseSepolia } from './base-sepolia';
import { getWalletRuntimeConfig } from './wallet-runtime-config';
import { createWalletMetadata } from './wallet-metadata';
import { resolveWalletReturnScheme } from './return-scheme';
import { getAppPackageId } from '@/config/app-identity';
import { resolveRuntimeIdentity } from '@/config/showcase-identity';

const runtimeIdentity = resolveRuntimeIdentity(
  getAppPackageId(),
  Constants.expoConfig?.extra,
  {
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    reownProjectId: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
  },
);
export const walletRuntimeConfig = getWalletRuntimeConfig({
  EXPO_PUBLIC_REOWN_PROJECT_ID: runtimeIdentity.reownProjectId,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

// The installed package decides the return scheme; a stale embedded config may not override it.
const appScheme = resolveWalletReturnScheme(Constants.expoConfig?.scheme, getAppPackageId());

export function createAccountScopedAppKit(
  config: typeof walletRuntimeConfig,
  accountId: string,
) {
  const normalizedAccountId = accountId.trim();
  return config.available && normalizedAccountId
    ? createAppKit({
      projectId: config.projectId,
      metadata: createWalletMetadata(appScheme),
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
