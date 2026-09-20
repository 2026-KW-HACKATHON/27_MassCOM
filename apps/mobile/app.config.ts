import type { ConfigContext, ExpoConfig } from 'expo/config';

const PRODUCTION_PACKAGE = 'kr.masscom.wolgye';

// APP_VARIANT=production builds the store app; anything else keeps the development app, which
// installs side by side under its own package and URL scheme.
export default ({ config }: ConfigContext): ExpoConfig => {
  const production = process.env.APP_VARIANT === 'production';
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
      ? (config.plugins ?? []).filter((plugin) => plugin !== 'expo-dev-client')
      : config.plugins,
  };
};
