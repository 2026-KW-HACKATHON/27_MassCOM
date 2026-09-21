export type NitroGoogleResponse = {
  type?: 'success' | 'noSavedCredentialFound' | 'cancelled';
  data?: { idToken?: string | null };
  idToken?: string | null;
};

export type NitroGoogleSurface = {
  configure(options: { webClientId: string; offlineAccess: false }): void;
  signIn(): Promise<NitroGoogleResponse>;
  createAccount(): Promise<NitroGoogleResponse>;
  signOut(): Promise<void>;
};

export type GoogleSignInErrorCode =
  | 'GOOGLE_WEB_CLIENT_ID_MISSING'
  | 'GOOGLE_SIGN_IN_NOT_CONFIGURED'
  | 'GOOGLE_SIGN_IN_CANCELLED'
  | 'GOOGLE_ID_TOKEN_MISSING'
  | 'GOOGLE_SIGN_IN_FAILED';

export class GoogleSignInAdapterError extends Error {
  constructor(readonly code: GoogleSignInErrorCode) {
    super(code);
    this.name = 'GoogleSignInAdapterError';
  }
}

export function createGoogleSignInAdapter(surface: NitroGoogleSurface) {
  let configuredWebClientId: string | undefined;

  function configure(webClientId: string): void {
    const normalized = webClientId.trim();
    if (!normalized) throw new GoogleSignInAdapterError('GOOGLE_WEB_CLIENT_ID_MISSING');
    if (configuredWebClientId === normalized) return;
    surface.configure({ webClientId: normalized, offlineAccess: false });
    configuredWebClientId = normalized;
  }

  async function signIn(): Promise<{ idToken: string }> {
    if (!configuredWebClientId) {
      throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_NOT_CONFIGURED');
    }
    try {
      let response = await surface.signIn();
      if (response.type === 'noSavedCredentialFound') {
        response = await surface.createAccount();
      }
      if (response.type === 'cancelled') {
        throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_CANCELLED');
      }
      const idToken = response.data?.idToken?.trim() || response.idToken?.trim();
      if (!idToken) throw new GoogleSignInAdapterError('GOOGLE_ID_TOKEN_MISSING');
      return { idToken };
    } catch (error) {
      if (error instanceof GoogleSignInAdapterError) throw error;
      if (isCancelledNativeError(error)) {
        throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_CANCELLED');
      }
      throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_FAILED');
    }
  }

  return {
    configure,
    signIn,
    async signOut(): Promise<void> {
      try {
        await surface.signOut();
      } catch {
        throw new GoogleSignInAdapterError('GOOGLE_SIGN_IN_FAILED');
      }
    },
  };
}

function isCancelledNativeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'SIGN_IN_CANCELLED';
}

export type GoogleSignInAdapter = ReturnType<typeof createGoogleSignInAdapter>;
