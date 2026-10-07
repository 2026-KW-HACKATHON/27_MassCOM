import type { ConfigContext, ExpoConfig } from 'expo/config';

import type * as BuildEnvironment from './src/config/build-environment';

const { SHOWCASE_API_ORIGIN, validateBuildEnvironment } = require(
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
  const firebaseServicesFile = process.env.MASSCOM_FIREBASE_GOOGLE_SERVICES_FILE?.trim();
  const webBaseUrl = process.env.MASSCOM_WEB_BASE_URL?.trim();
  const notificationProjectId = process.env.MASSCOM_NOTIFICATION_PROJECT_ID?.trim();
  if (notificationProjectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationProjectId)) {
    throw new Error('MASSCOM_NOTIFICATION_PROJECT_ID must be a UUID');
  }
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
    './plugins/with-naver-map-repository.cjs',
    'expo-secure-store',
    ['expo-location', {
      locationWhenInUsePermission: '가게와의 거리와 도보 출발지를 확인할 때만 위치를 사용합니다. 지역을 직접 정해 사용할 수도 있어요.',
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
      isIosBackgroundLocationEnabled: false,
    }] satisfies [string, Record<string, unknown>],
    ['expo-audio', {
      recordAudioAndroid: false,
      microphonePermission: false,
      enableBackgroundPlayback: false,
      enableBackgroundRecording: false,
    }] satisfies [string, Record<string, unknown>],
    ['expo-notifications', { defaultChannel: 'masscom-updates' }] satisfies [string, Record<string, unknown>],
  ];
  return {
    ...config,
    name: production ? '월계 마스코트'
      : showcase ? '월계 마스코트 체험용'
        : (config.name ?? '월계 마스코트 개발'),
    slug: config.slug ?? 'masscom-mobile',
    scheme: production ? 'masscom' : showcase ? 'masscom-demo' : 'masscom-dev',
    // 웹 체험은 시연 전용이다(PR #313 리뷰 P1). 실측(2026-10-02): `platforms`를 좁혀도
    // `expo export --platform web`은 여전히 성공한다 — Expo CLI가 export 때 이 필드를 보지
    // 않는다(`expo start`의 플랫폼 메뉴 등에만 영향). 그래서 이 필드는 참고용으로만 남기고,
    // 실제 방어는 MASSCOM_WEB_BASE_URL이 showcase에만 허용되는 위 validateBuildEnvironment 검사와
    // (그 검사를 피해 web을 내보내도) auth-provider.tsx의 런타임 가드
    // (getAppPackageId() + API origin 조합, isApprovedGuestTrialOrigin)가 맡는다.
    // 로컬 개발 웹도 Metro가 HTML로 제공해야 한다. 체험 인증은 위의 런타임 가드로 loopback API에만 허용한다.
    platforms: production ? ['android'] : ['android', 'web'],
    experiments: {
      ...config.experiments,
      ...(webBaseUrl ? { baseUrl: webBaseUrl } : null),
    },
    extra: {
      ...config.extra,
      masscomMaps: { provider: 'TMAP', sdkAppKey: process.env.EXPO_PUBLIC_TMAP_MAP_APP_KEY?.trim() || undefined,
        fallbackProvider: 'NAVER', naverClientId: process.env.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID?.trim() || undefined },
      ...(notificationProjectId ? { eas: { projectId: notificationProjectId } } : {}),
      // 시연 API origin은 시연 빌드의 extra에만 둔다(Issue #325). JS 소스에 리터럴로 두면 운영 번들에도
      // 들어가 scripts/check-embedded-api.sh가 운영 AAB를 막는다. validateBuildEnvironment가 시연
      // EXPO_PUBLIC_API_URL에 요구하는 것과 같은 상수다.
      masscomShowcase: showcase
        ? {
            googleWebClientId: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID?.trim(),
            apiOrigin: SHOWCASE_API_ORIGIN,
          }
        : undefined,
    },
    android: {
      ...config.android,
      ...(firebaseServicesFile ? { googleServicesFile: firebaseServicesFile } : {}),
      package: production ? PRODUCTION_PACKAGE
        : showcase ? `${PRODUCTION_PACKAGE}.demo` : `${PRODUCTION_PACKAGE}.dev`,
      // The development client library declares the overlay permission; the store app never uses it.
      // 수집품 음성은 재생만 한다. 어떤 라이브러리(expo-audio·expo-camera·의존성)가 끌어와도 마이크 권한은 빌드에 남기지 않는다.
      blockedPermissions: [
        ...(releaseLike ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
        'android.permission.RECORD_AUDIO',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.QUERY_ALL_PACKAGES',
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
