export type AuthSessionErrorCode =
  | 'SESSION_REQUIRED'
  | 'SESSION_INVALID'
  | 'REAUTHENTICATION_REQUIRED'
  | 'IDENTITY_MISMATCH';

export class AuthSessionError extends Error {
  constructor(readonly code: AuthSessionErrorCode) {
    super(code);
    this.name = 'AuthSessionError';
  }
}

/** The session token is returned exactly once, at sign-in; only its hash is stored. */
export type IssuedSession = {
  sessionToken: string;
  accountId: string;
  expiresAt: string;
};

export interface AuthSessionService {
  signInWithGoogle(idToken: string): Promise<IssuedSession>;
  resolve(sessionToken: string): Promise<string>;
  logout(sessionToken: string): Promise<void>;
  reauthenticate(sessionToken: string, idToken: string): Promise<void>;
  assertRecentlyAuthenticated(sessionToken: string, windowMs?: number): Promise<string>;
}
