type DemoEnvironment = Partial<
  Record<
    | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ID',
    string
  >
>;

export type DemoRuntimeConfig = {
  customerAccountId?: string;
  merchant?: {
    accountId: string;
    merchantId: string;
  };
};

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
  };
}

export const demoRuntimeConfig = getDemoRuntimeConfig({
  EXPO_PUBLIC_DEMO_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ID,
  EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID,
  EXPO_PUBLIC_DEMO_MERCHANT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ID,
});

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}
