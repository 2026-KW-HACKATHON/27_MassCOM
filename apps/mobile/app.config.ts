import type { ConfigContext, ExpoConfig } from 'expo/config';

import type * as BuildEnvironment from './src/config/build-environment';

const { validateBuildEnvironment } = require(
  './src/config/build-environment.cjs'
) as typeof BuildEnvironment;

const PRODUCTION_PACKAGE = 'kr.masscom.wolgye';

// APP_VARIANT=production builds the store app; anything else keeps the development app, which
// installs side by side under its own package and URL scheme.
export default ({ config }: ConfigContext): ExpoConfig => {
  const production = process.env.APP_VARIANT === 'production';
  const buildSourceCommit = process.env.MASSCOM_BUILD_SOURCE_COMMIT;
  validateBuildEnvironment(process.env.APP_VARIANT, {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ID,
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID,
    EXPO_PUBLIC_DEMO_MERCHANT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ID,
    EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION:
      process.env.EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION,
  });

  const plugins = production
    ? (config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-dev-client',
      )
    : config.plugins;
  return {
    ...config,
    name: production ? '월계 마스코트' : (config.name ?? '월계 마스코트 개발'),
    slug: config.slug ?? 'masscom-mobile',
    scheme: production ? 'masscom' : 'masscom-dev',
    android: {
      ...config.android,
      package: production ? PRODUCTION_PACKAGE : `${PRODUCTION_PACKAGE}.dev`,
      // The development client library declares this overlay permission; the store app never uses it.
      blockedPermissions: production ? ['android.permission.SYSTEM_ALERT_WINDOW'] : [],
    },
    plugins: production
      ? [
          ...(plugins ?? []),
          ['./plugins/with-build-source-commit.cjs', { commit: buildSourceCommit }],
        ]
      : plugins,
  };
};
