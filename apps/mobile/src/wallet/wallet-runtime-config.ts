const requiredEnvironmentKeys = [
  'EXPO_PUBLIC_REOWN_PROJECT_ID',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
] as const;

type EnvironmentKey = (typeof requiredEnvironmentKeys)[number];
type Environment = Partial<Record<EnvironmentKey, string>>;

type UnavailableWalletRuntimeConfig = {
  available: false;
  missing: EnvironmentKey[];
};

export type AvailableWalletRuntimeConfig = {
  available: true;
  projectId: string;
  apiUrl: string;
  accountId: string;
  chainId: 84532;
  caipNetworkId: 'eip155:84532';
  features: {
    socials: false;
    swaps: false;
    onramp: false;
    showWallets: true;
  };
  enableAnalytics: false;
  sessionPermissions: {
    methods: Record<string, string[]>;
    chains: Record<string, string[]>;
    events: Record<string, string[]>;
    rpcMap: Record<string, string>;
  };
};

export type WalletRuntimeConfig = UnavailableWalletRuntimeConfig | AvailableWalletRuntimeConfig;

export function getWalletRuntimeConfig(environment: Environment): WalletRuntimeConfig {
  const missing = requiredEnvironmentKeys.filter((key) => !environment[key]?.trim());
  if (missing.length > 0) {
    return { available: false, missing };
  }

  const apiUrl = environment.EXPO_PUBLIC_API_URL!.trim().replace(/\/$/, '');
  assertSafeApiUrl(apiUrl);

  return {
    available: true,
    projectId: environment.EXPO_PUBLIC_REOWN_PROJECT_ID!.trim(),
    apiUrl,
    accountId: environment.EXPO_PUBLIC_DEMO_ACCOUNT_ID!.trim(),
    chainId: 84532,
    caipNetworkId: 'eip155:84532',
    features: {
      socials: false,
      swaps: false,
      onramp: false,
      showWallets: true,
    },
    enableAnalytics: false,
    sessionPermissions: {
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
    },
  };
}

function assertSafeApiUrl(value: string): void {
  const url = new URL(value);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '10.0.2.2']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))) {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTPS outside approved local development hosts');
  }
}
