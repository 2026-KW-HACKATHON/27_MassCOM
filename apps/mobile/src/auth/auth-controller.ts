import type { AccountCredential } from './account-credential';
import { AuthApiError, type AuthApiClient } from './auth-api';
import { GoogleSignInAdapterError, type GoogleSignInAdapter } from './google-sign-in';
import type { StoredAuthSessionV1, createSessionStore } from './session-store';

export type SignedOutReason =
  | 'SECURE_STORAGE_UNAVAILABLE'
  | 'GOOGLE_SIGN_IN_CANCELLED'
  | 'ACCOUNT_NOT_INVITED'
  | 'NETWORK_ERROR'
  | 'GOOGLE_SIGN_IN_FAILED'
  | 'LOGIN_RATE_LIMITED'
  | 'SIGN_IN_FAILED'
  | 'SERVER_SESSION_REVOCATION_FAILED'
  | 'WALLET_STORAGE_CLEANUP_FAILED'
  | 'ACCOUNT_SWITCH_UNCHANGED';

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
  let operationTail: Promise<void> = Promise.resolve();

  function setState(next: AuthState) {
    state = next;
    dependencies.publish(next);
  }

  function serialize(work: () => Promise<void>): Promise<void> {
    const result = operationTail.then(work, work);
    operationTail = result.catch(() => undefined);
    return result;
  }

  async function performRestore(): Promise<void> {
    setState({ status: 'restoring' });
    try {
      const session = await dependencies.sessionStore.load();
      setState(session ? signedIn(session) : { status: 'signedOut' });
    } catch {
      setState({ status: 'signedOut', reason: 'SECURE_STORAGE_UNAVAILABLE' });
    }
  }

  async function performSignIn(previousAccountId?: string): Promise<void> {
    let issued: StoredAuthSessionV1 | undefined;
    try {
      const google = await dependencies.google.signIn();
      issued = await dependencies.authApi.signIn(google.idToken);
      if (previousAccountId && issued.accountId === previousAccountId) {
        await dependencies.authApi.logout(issued.sessionToken).catch(() => undefined);
        issued = undefined;
        setState({ status: 'signedOut', reason: 'ACCOUNT_SWITCH_UNCHANGED' });
        throw new AuthControllerError('ACCOUNT_SWITCH_UNCHANGED');
      }
      await dependencies.sessionStore.save(issued);
      setState(signedIn(issued));
    } catch (error) {
      if (issued) {
        await dependencies.sessionStore.clear().catch(() => undefined);
        await dependencies.authApi.logout(issued.sessionToken).catch(() => undefined);
      }
      const reason = authFailureReason(error);
      setState({ status: 'signedOut', reason });
      throw new AuthControllerError(reason);
    }
  }

  async function clearCurrentSession(
    session: StoredAuthSessionV1 | undefined,
    publishSignedOut: boolean,
  ): Promise<void> {
    let revocationFailed = false;
    if (session) await dependencies.authApi.logout(session.sessionToken).catch(() => {
      revocationFailed = true;
    });
    let storageFailed = false;
    await dependencies.sessionStore.clear().catch(() => {
      storageFailed = true;
    });
    let walletStorageFailed = false;
    await dependencies.clearWalletSession().catch(() => {
      walletStorageFailed = true;
    });
    await dependencies.google.signOut().catch(() => undefined);
    const reason = walletStorageFailed
      ? 'WALLET_STORAGE_CLEANUP_FAILED'
      : storageFailed
        ? 'SECURE_STORAGE_UNAVAILABLE'
        : revocationFailed
          ? 'SERVER_SESSION_REVOCATION_FAILED'
          : undefined;
    if (publishSignedOut || reason) {
      setState(reason ? { status: 'signedOut', reason } : { status: 'signedOut' });
    }
    if (reason) throw new AuthControllerError(reason);
  }

  async function performLogout(): Promise<void> {
    const session = state.status === 'signedIn' ? state.session : undefined;
    await clearCurrentSession(session, true);
  }

  async function performSwitchAccount(): Promise<void> {
    const session = state.status === 'signedIn' ? state.session : undefined;
    if (session) setState({ status: 'switchingAccount', previousAccountId: session.accountId });
    await clearCurrentSession(session, false);
    await performSignIn(session?.accountId);
  }

  async function performInvalidation(sessionToken: string): Promise<void> {
    if (state.status !== 'signedIn' || state.session.sessionToken !== sessionToken) return;
    await clearCurrentSession(state.session, true);
  }

  return {
    getState: () => state,
    restore: () => serialize(performRestore),
    signIn: () => serialize(async () => {
      if (state.status === 'signedIn' || state.status === 'switchingAccount') return;
      await performSignIn();
    }),
    logout: () => serialize(performLogout),
    switchAccount: () => serialize(performSwitchAccount),
    invalidateSession: (sessionToken: string) =>
      serialize(() => performInvalidation(sessionToken)),
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
  if (error instanceof AuthControllerError) return error.code;
  if (error instanceof AuthApiError && error.code === 'INVITE_REQUIRED') return 'ACCOUNT_NOT_INVITED';
  if (error instanceof AuthApiError && error.code === 'NETWORK_ERROR') return 'NETWORK_ERROR';
  if (error instanceof AuthApiError && error.code === 'LOGIN_RATE_LIMITED') return 'LOGIN_RATE_LIMITED';
  if (error instanceof GoogleSignInAdapterError && error.code === 'GOOGLE_SIGN_IN_FAILED') {
    return 'GOOGLE_SIGN_IN_FAILED';
  }
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
