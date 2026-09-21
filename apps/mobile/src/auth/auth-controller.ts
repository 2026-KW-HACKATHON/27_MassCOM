import type { AccountCredential } from './account-credential';
import type { AuthApiClient } from './auth-api';
import type { GoogleSignInAdapter } from './google-sign-in';
import type { StoredAuthSessionV1, createSessionStore } from './session-store';

export type SignedOutReason =
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'GOOGLE_SIGN_IN_CANCELLED'
  | 'SIGN_IN_FAILED';

export type AuthState =
  | { status: 'restoring' }
  | { status: 'signedOut'; reason?: SignedOutReason }
  | {
      status: 'signedIn';
      session: StoredAuthSessionV1;
      credential: Extract<AccountCredential, { kind: 'bearer' }>;
    }
  | { status: 'switchingAccount'; previousAccountId: string };

type SessionStore = ReturnType<typeof createSessionStore>;

export type AuthControllerDependencies = {
  sessionStore: Pick<SessionStore, 'load' | 'save' | 'clear'>;
  authApi: Pick<AuthApiClient, 'signIn' | 'logout'>;
  google: Pick<GoogleSignInAdapter, 'signIn' | 'signOut'>;
  clearWalletSession: () => Promise<void>;
  publish: (state: AuthState) => void;
};

export class AuthControllerError extends Error {
  constructor(readonly code: SignedOutReason) {
    super(code);
    this.name = 'AuthControllerError';
  }
}

export function createAuthController(dependencies: AuthControllerDependencies) {
  let state: AuthState = { status: 'restoring' };

  function setState(next: AuthState) {
    state = next;
    dependencies.publish(next);
  }

  async function restore(): Promise<void> {
    setState({ status: 'restoring' });
    try {
      const session = await dependencies.sessionStore.load();
      setState(session ? signedIn(session) : { status: 'signedOut' });
    } catch {
      setState({ status: 'signedOut', reason: 'SECURE_STORAGE_UNAVAILABLE' });
    }
  }

  async function signIn(): Promise<void> {
    let issued: StoredAuthSessionV1 | undefined;
    try {
      const google = await dependencies.google.signIn();
      issued = await dependencies.authApi.signIn(google.idToken);
      await dependencies.sessionStore.save(issued);
      setState(signedIn(issued));
    } catch (error) {
      if (issued) await dependencies.authApi.logout(issued.sessionToken).catch(() => undefined);
      const reason = authFailureReason(error);
      setState({ status: 'signedOut', reason });
      throw new AuthControllerError(reason);
    }
  }

  async function clearCurrentSession(session?: StoredAuthSessionV1): Promise<void> {
    if (session) await dependencies.authApi.logout(session.sessionToken).catch(() => undefined);
    let storageFailed = false;
    await dependencies.sessionStore.clear().catch(() => {
      storageFailed = true;
    });
    await dependencies.clearWalletSession().catch(() => undefined);
    await dependencies.google.signOut().catch(() => undefined);
    setState(storageFailed
      ? { status: 'signedOut', reason: 'SECURE_STORAGE_UNAVAILABLE' }
      : { status: 'signedOut' });
  }

  async function logout(): Promise<void> {
    const session = state.status === 'signedIn' ? state.session : undefined;
    await clearCurrentSession(session);
  }

  async function switchAccount(): Promise<void> {
    const session = state.status === 'signedIn' ? state.session : undefined;
    if (session) setState({ status: 'switchingAccount', previousAccountId: session.accountId });
    await clearCurrentSession(session);
    await signIn();
  }

  return {
    getState: () => state,
    restore,
    signIn,
    logout,
    switchAccount,
  };
}

function signedIn(session: StoredAuthSessionV1): Extract<AuthState, { status: 'signedIn' }> {
  return {
    status: 'signedIn',
    session,
    credential: { kind: 'bearer', sessionToken: session.sessionToken },
  };
}

function authFailureReason(error: unknown): SignedOutReason {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'GOOGLE_SIGN_IN_CANCELLED'
  ) return 'GOOGLE_SIGN_IN_CANCELLED';
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && ['READ_FAILED', 'WRITE_FAILED', 'DELETE_FAILED'].includes(
      String((error as { code?: unknown }).code),
    )
  ) return 'SECURE_STORAGE_UNAVAILABLE';
  return 'SIGN_IN_FAILED';
}
