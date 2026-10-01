// Mirrors src/wallet/return-scheme.ts's packageSchemes (package -> scheme), inverted. Web's
// Constants.expoConfig drops platform-only keys like `android` entirely, so `scheme` (which it
// keeps) is the only build-time signal left to recover which variant a web bundle is.
const schemePackages: Record<string, string> = {
  masscom: 'kr.masscom.wolgye',
  'masscom-dev': 'kr.masscom.wolgye.dev',
  'masscom-demo': 'kr.masscom.wolgye.demo',
};

export function packageIdFromScheme(scheme: string | string[] | undefined): string | undefined {
  const configured = Array.isArray(scheme) ? scheme[0] : scheme;
  return configured ? schemePackages[configured] : undefined;
}
