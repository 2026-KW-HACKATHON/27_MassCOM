export type MobileBuildEnvironment = Partial<
  Record<
    | 'EXPO_PUBLIC_API_URL'
    | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ID'
    | 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
    string
  >
>;

const demoKeys = [
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
] as const;

export function validateBuildEnvironment(
  variant: string | undefined,
  environment: MobileBuildEnvironment,
): void {
  if (variant !== 'production') return;

  const rawApiUrl = environment.EXPO_PUBLIC_API_URL?.trim();
  if (!rawApiUrl) throw new Error('production EXPO_PUBLIC_API_URL is required');

  const apiUrl = new URL(rawApiUrl);
  if (
    apiUrl.protocol !== 'https:' ||
    ['localhost', '127.0.0.1', '10.0.2.2'].includes(apiUrl.hostname)
  ) {
    throw new Error('production API must use non-loopback HTTPS');
  }

  const unsafeKey = demoKeys.find((key) => environment[key]?.trim());
  if (unsafeKey) throw new Error(`production build rejects ${unsafeKey}`);
}
