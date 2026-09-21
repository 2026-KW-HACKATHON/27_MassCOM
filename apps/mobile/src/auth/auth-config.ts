export const GOOGLE_WEB_CLIENT_ID_ENV = 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' as const;

export type AuthConfiguration =
  | { available: true; webClientId: string }
  | { available: false; missing: readonly [typeof GOOGLE_WEB_CLIENT_ID_ENV] };

export function getAuthConfiguration(environment: {
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
}): AuthConfiguration {
  const webClientId = environment.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  return webClientId
    ? { available: true, webClientId }
    : { available: false, missing: [GOOGLE_WEB_CLIENT_ID_ENV] };
}
