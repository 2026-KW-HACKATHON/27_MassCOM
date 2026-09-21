export type AccountCredential =
  | { kind: 'bearer'; sessionToken: string }
  | { kind: 'demo'; accountId: string; allowInsecureReauthentication: boolean };

export function assertCredential(
  credential: AccountCredential,
): asserts credential is AccountCredential {
  if (credential.kind === 'bearer') {
    if (!credential.sessionToken.trim()) throw new Error('bearer session token is required');
    return;
  }
  if (!credential.accountId.trim()) throw new Error('demo account ID is required');
}

export function headersForCredential(credential: AccountCredential): Record<string, string> {
  assertCredential(credential);
  return credential.kind === 'bearer'
    ? { Authorization: `Bearer ${credential.sessionToken.trim()}` }
    : { 'x-account-id': credential.accountId.trim() };
}
