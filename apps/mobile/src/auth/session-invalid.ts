import type { AccountCredential } from './account-credential';

export function shouldInvalidateSession(
  credential: AccountCredential,
  status: number,
  code: string,
): boolean {
  return credential.kind === 'bearer' && status === 401 && code === 'SESSION_INVALID';
}
