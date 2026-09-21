import type { AccountCredential } from '@/auth/account-credential';

export type DestructiveReauthentication = 'BLOCKED' | 'DEMO_ALLOWED';

export function deletionCapability(
  credential: AccountCredential,
  _destructiveReauthentication: DestructiveReauthentication,
):
  | { allowed: true }
  | {
      allowed: false;
      reason: 'DESTRUCTIVE_REAUTHENTICATION_BLOCKED' | 'DEMO_REAUTHENTICATION_REQUIRED';
    } {
  if (credential.kind === 'bearer') {
    return { allowed: false, reason: 'DESTRUCTIVE_REAUTHENTICATION_BLOCKED' };
  }
  return credential.allowInsecureReauthentication
    ? { allowed: true }
    : { allowed: false, reason: 'DEMO_REAUTHENTICATION_REQUIRED' };
}
