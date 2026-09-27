type ShowcaseEnvironment = Record<string, string | undefined>;

// The variable name is retained for existing hosted runtime files. These hashes now
// gate only explicit STAFF grants; verified customer sign-in never reads this list.
export function resolveShowcaseInviteConfig(environment: ShowcaseEnvironment):
  { allowedSubjectHashes: ReadonlySet<string> } | undefined {
  if (environment.SHOWCASE_MODE !== 'true') {
    if (environment.SHOWCASE_MODE || environment.SHOWCASE_INVITED_SUBJECT_SHA256) {
      throw new Error('SHOWCASE_CONFIGURATION_REQUIRED');
    }
    return undefined;
  }

  let databaseName: string | undefined;
  try {
    const url = new URL(environment.DATABASE_URL ?? '');
    if (url.protocol === 'postgresql:' && !url.search && !url.hash) {
      databaseName = decodeURIComponent(url.pathname.slice(1));
    }
  } catch {
    // Never expose a URL containing database credentials in an error.
  }
  const audiences = (environment.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',').map((value) => value.trim());
  const hashes = (environment.SHOWCASE_INVITED_SUBJECT_SHA256 ?? '')
    .split(',').map((value) => value.trim());
  if (
    databaseName !== 'masscom_showcase' ||
    audiences.length !== 1 || !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(audiences[0] ?? '') ||
    hashes.length === 0 || hashes.some((value) => !/^[0-9a-f]{64}$/.test(value)) ||
    environment.ALLOW_INSECURE_DEMO_ACCOUNT === 'true'
  ) {
    throw new Error('SHOWCASE_CONFIGURATION_REQUIRED');
  }
  return { allowedSubjectHashes: new Set(hashes) };
}
