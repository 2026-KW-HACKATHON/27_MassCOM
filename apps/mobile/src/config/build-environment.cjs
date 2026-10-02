const { BlockList, isIP } = require('node:net');

const demoKeys = [
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
];

// 빌드 때만 읽는 파일이라 앱 번들에 들어가지 않는다. 시연 origin은 여기 하나만 둔다(Issue #325).
const SHOWCASE_API_ORIGIN = 'https://demo-api.masscom.kr';

const localAddresses = new BlockList();
localAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
localAddresses.addAddress('0.0.0.0', 'ipv4');
localAddresses.addAddress('10.0.2.2', 'ipv4');
localAddresses.addAddress('::', 'ipv6');
localAddresses.addAddress('::1', 'ipv6');
localAddresses.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');
localAddresses.addAddress('::ffff:0.0.0.0', 'ipv6');
localAddresses.addAddress('::ffff:10.0.2.2', 'ipv6');

function validateBuildEnvironment(variant, environment) {
  const selectedVariant = variant || 'development';
  if (!['development', 'showcase', 'production'].includes(selectedVariant)) {
    throw new Error('UNSUPPORTED_APP_VARIANT');
  }
  // 웹 내보내기는 시연 전용이다: masscom.kr(운영)과 겹치지 않는 별도 origin(demo-api.masscom.kr/play)에만 둔다.
  if (environment.MASSCOM_WEB_BASE_URL?.trim() && selectedVariant !== 'showcase') {
    throw new Error(`${selectedVariant} build rejects MASSCOM_WEB_BASE_URL`);
  }
  if (selectedVariant === 'development') return;

  const rawApiUrl = environment.EXPO_PUBLIC_API_URL?.trim();
  if (!rawApiUrl) throw new Error(`${selectedVariant} EXPO_PUBLIC_API_URL is required`);

  let apiUrl;
  try {
    apiUrl = new URL(rawApiUrl);
  } catch {
    throw new Error(`${selectedVariant} API URL is invalid`);
  }
  if (selectedVariant === 'production' &&
      (apiUrl.protocol !== 'https:' || isLocalHostname(apiUrl.hostname))) {
    throw new Error('production API must use non-loopback HTTPS');
  }
  const expectedOrigin = selectedVariant === 'production'
    ? 'https://api.masscom.kr' : SHOWCASE_API_ORIGIN;
  if (apiUrl.origin !== expectedOrigin || apiUrl.pathname !== '/' ||
      rawApiUrl.includes('?') || rawApiUrl.includes('#') ||
      apiUrl.username || apiUrl.password || apiUrl.port) {
    throw new Error(`${selectedVariant} API must use ${expectedOrigin}`);
  }

  const buildSourceCommit = environment.MASSCOM_BUILD_SOURCE_COMMIT?.trim();
  if (!buildSourceCommit) throw new Error(`${selectedVariant} build source commit is required`);
  if (!/^[0-9a-f]{40}$/i.test(buildSourceCommit)) {
    throw new Error(`${selectedVariant} build source commit must be 40 hexadecimal characters`);
  }

  const unsafeKey = demoKeys.find((key) => environment[key]?.trim());
  if (unsafeKey) throw new Error(`${selectedVariant} build rejects ${unsafeKey}`);
  if (selectedVariant === 'showcase') {
    for (const key of ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_REOWN_PROJECT_ID']) {
      if (environment[key]?.trim()) throw new Error(`showcase build rejects ${key}`);
    }
    const googleWebClientId = environment.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID?.trim();
    if (!googleWebClientId || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleWebClientId)) {
      throw new Error('showcase MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID is required');
    }
  }
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const addressFamily = isIP(normalized);
  if (addressFamily === 4) return localAddresses.check(normalized, 'ipv4');
  if (addressFamily === 6) return localAddresses.check(normalized, 'ipv6');
  return false;
}

module.exports = { validateBuildEnvironment, SHOWCASE_API_ORIGIN };
