import type { ConfigContext, ExpoConfig } from 'expo/config';

import type * as BuildEnvironment from './src/config/build-environment';

const { validateBuildEnvironment } = require(
  './src/config/build-environment.cjs'
) as typeof BuildEnvironment;

const PRODUCTION_PACKAGE = 'kr.masscom.wolgye';

// Each installed variant has its own package and return scheme. Unknown variants fail validation.
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT || 'development';
  const production = variant === 'production';
  const showcase = variant === 'showcase';
  const releaseLike = production || showcase;
  const buildSourceCommit = process.env.MASSCOM_BUILD_SOURCE_COMMIT;
  validateBuildEnvironment(variant, {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_REOWN_PROJECT_ID: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
    MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID,
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_ACCOUNT_ID,
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID,
    EXPO_PUBLIC_DEMO_MERCHANT_ID: process.env.EXPO_PUBLIC_DEMO_MERCHANT_ID,
    EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION:
      process.env.EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION,
  });

  const plugins = releaseLike
    ? (config.plugins ?? []).filter(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-dev-client',
      )
    : config.plugins;
  const authPlugins = [
    ...(plugins ?? []),
    'expo-secure-store',
  ];
  return {
    ...config,
    name: production ? '월계 마스코트'
      : showcase ? '월계 마스코트 체험용'
        : (config.name ?? '월계 마스코트 개발'),
    slug: config.slug ?? 'masscom-mobile',
    scheme: production ? 'masscom' : showcase ? 'masscom-demo' : 'masscom-dev',
    extra: {
      ...config.extra,
      masscomShowcase: showcase
        ? { googleWebClientId: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID?.trim() }
        : undefined,
    },
    android: {
      ...config.android,
      package: production ? PRODUCTION_PACKAGE
        : showcase ? `${PRODUCTION_PACKAGE}.demo` : `${PRODUCTION_PACKAGE}.dev`,
      // The development client library declares this overlay permission; the store app never uses it.
      blockedPermissions: releaseLike ? ['android.permission.SYSTEM_ALERT_WINDOW'] : [],
      intentFilters: releaseLike
        ? [
            {
              action: 'VIEW',
              autoVerify: true,
              category: ['BROWSABLE', 'DEFAULT'],
              data: [{ scheme: 'https', host: showcase ? 'demo.masscom.kr' : 'masscom.kr', pathPrefix: '/open' }],
            },
          ]
        : [],
    },
    plugins: releaseLike
      ? [
          ...authPlugins,
          ['./plugins/with-build-source-commit.cjs', { commit: buildSourceCommit }],
        ]
      : authPlugins,
  };
};
