export type MobileBuildEnvironment = Partial<
  Record<
    | 'EXPO_PUBLIC_API_URL'
    | 'MASSCOM_BUILD_SOURCE_COMMIT'
    | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ID'
    | 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
    string
  >
>;

export { validateBuildEnvironment } from './build-environment.cjs';
