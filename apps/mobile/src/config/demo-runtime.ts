import type { AccountCredential } from '@/auth/account-credential';

type DemoEnvironment = Partial<
  Record<
    | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ID'
    | 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
    string
  >
>;

export type DemoRuntimeConfig = {
  customerAccountId?: string;
  merchant?: {
    accountId: string;
    merchantId: string;
  };
  allowInsecureDemoReauthentication: boolean;
};

export function isDevelopmentDemoBuild(applicationId: string | null | undefined): boolean {
  return applicationId === 'kr.masscom.wolgye.dev';
}

export function getDemoRuntimeConfig(environment: DemoEnvironment): DemoRuntimeConfig {
  const customerAccountId = trimmed(environment.EXPO_PUBLIC_DEMO_ACCOUNT_ID);
  const merchantAccountId = trimmed(environment.EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID);
  const merchantId = trimmed(environment.EXPO_PUBLIC_DEMO_MERCHANT_ID);

  return {
    customerAccountId,
    merchant:
      merchantAccountId && merchantId
        ? { accountId: merchantAccountId, merchantId }
        : undefined,
    allowInsecureDemoReauthentication:
      environment.EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION === 'true',
  };
}

export const demoRuntimeConfig = getDemoRuntimeConfig({
  EXPO_PUBLIC_DEMO_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ID,
  EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID,
  EXPO_PUBLIC_DEMO_MERCHANT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ID,
  EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION:
    process.env.EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION,
});

export function canOpenMerchantDemo(
  credential: AccountCredential,
  config: DemoRuntimeConfig,
): boolean {
  return credential.kind === 'demo' && Boolean(config.merchant);
}

export function createDemoCredential(
  accountId: string,
  allowInsecureReauthentication = false,
): Extract<AccountCredential, { kind: 'demo' }> {
  return { kind: 'demo', accountId, allowInsecureReauthentication };
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}
