type PublicApiEnvironment = Partial<Record<'EXPO_PUBLIC_API_URL', string>>;

export type PublicApiConfig =
  | {
      available: false;
      missing: readonly ['EXPO_PUBLIC_API_URL'];
    }
  | {
      available: true;
      apiUrl: string;
    };

export function getPublicApiConfig(environment: PublicApiEnvironment): PublicApiConfig {
  const rawApiUrl = environment.EXPO_PUBLIC_API_URL?.trim();
  if (!rawApiUrl) {
    return { available: false, missing: ['EXPO_PUBLIC_API_URL'] };
  }

  return {
    available: true,
    apiUrl: normalizePublicApiUrl(rawApiUrl),
  };
}

export function normalizePublicApiUrl(value: string): string {
  const normalized = value.replace(/\/+$/, '');
  const url = new URL(normalized);
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '10.0.2.2']);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.has(url.hostname))) {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTPS outside approved local development hosts');
  }

  return normalized;
}
