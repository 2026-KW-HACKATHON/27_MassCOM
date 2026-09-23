const packageSchemes: Record<string, string> = {
  'kr.masscom.wolgye': 'masscom',
  'kr.masscom.wolgye.dev': 'masscom-dev',
  'kr.masscom.wolgye.demo': 'masscom-demo',
};

const knownSchemes = new Set(Object.values(packageSchemes));

export function resolveWalletReturnScheme(
  configuredScheme: string | string[] | undefined,
  applicationId: string | null | undefined,
): string {
  const configured = Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme;
  if (applicationId) {
    const expected = packageSchemes[applicationId];
    if (!expected) throw new Error('WALLET_RETURN_SCHEME_UNAVAILABLE');
    if (configured && configured !== expected) throw new Error('WALLET_RETURN_SCHEME_MISMATCH');
    return expected;
  }
  if (configured && knownSchemes.has(configured)) return configured;
  throw new Error('WALLET_RETURN_SCHEME_UNAVAILABLE');
}
