const { BlockList, isIP } = require('node:net');

const demoKeys = [
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
];

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
  if (variant !== 'production') return;

  const rawApiUrl = environment.EXPO_PUBLIC_API_URL?.trim();
  if (!rawApiUrl) throw new Error('production EXPO_PUBLIC_API_URL is required');

  const apiUrl = new URL(rawApiUrl);
  if (apiUrl.protocol !== 'https:' || isLocalHostname(apiUrl.hostname)) {
    throw new Error('production API must use non-loopback HTTPS');
  }

  const unsafeKey = demoKeys.find((key) => environment[key]?.trim());
  if (unsafeKey) throw new Error(`production build rejects ${unsafeKey}`);
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const addressFamily = isIP(normalized);
  if (addressFamily === 4) return localAddresses.check(normalized, 'ipv4');
  if (addressFamily === 6) return localAddresses.check(normalized, 'ipv6');
  return false;
}

module.exports = { validateBuildEnvironment };
