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
  const webBaseUrl = process.env.MASSCOM_WEB_BASE_URL?.trim();
  validateBuildEnvironment(variant, {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_REOWN_PROJECT_ID: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
    MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID,
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    MASSCOM_WEB_BASE_URL: webBaseUrl,
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
    ['expo-audio', {
      recordAudioAndroid: false,
      microphonePermission: false,
      enableBackgroundPlayback: false,
      enableBackgroundRecording: false,
    }] satisfies [string, Record<string, unknown>],
  ];
  return {
    ...config,
    name: production ? '월계 마스코트'
      : showcase ? '월계 마스코트 체험용'
        : (config.name ?? '월계 마스코트 개발'),
    slug: config.slug ?? 'masscom-mobile',
    scheme: production ? 'masscom' : showcase ? 'masscom-demo' : 'masscom-dev',
    experiments: {
      ...config.experiments,
      ...(webBaseUrl ? { baseUrl: webBaseUrl } : null),
    },
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
      // The development client library declares the overlay permission; the store app never uses it.
      // 수집품 음성은 재생만 한다. 어떤 라이브러리(expo-audio·expo-camera·의존성)가 끌어와도 마이크 권한은 빌드에 남기지 않는다.
      blockedPermissions: [
        ...(releaseLike ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
        'android.permission.RECORD_AUDIO',
      ],
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
