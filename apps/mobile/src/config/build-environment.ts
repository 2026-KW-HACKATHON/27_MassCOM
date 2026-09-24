export type MobileBuildEnvironment = Partial<
  Record<
    | 'EXPO_PUBLIC_API_URL'
    | 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'
    | 'EXPO_PUBLIC_REOWN_PROJECT_ID'
    | 'MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID'
    | 'MASSCOM_BUILD_SOURCE_COMMIT'
    | 'EXPO_PUBLIC_DEMO_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID'
    | 'EXPO_PUBLIC_DEMO_MERCHANT_ID'
    | 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
    string
  >
>;

export { validateBuildEnvironment } from './build-environment.cjs';
