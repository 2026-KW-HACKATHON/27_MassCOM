import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import { createContext, type PropsWithChildren, use, useEffect, useMemo, useRef, useState } from 'react';

import type { AccountCredential } from './account-credential';
import { AuthApiClient } from './auth-api';
import { getAuthConfiguration } from './auth-config';
import { createAuthController, type AuthState } from './auth-controller';
import { nativeGoogleSignIn } from './google-sign-in-runtime';
import { createSessionStore, type StoredAuthSessionV1 } from './session-store';
import { demoRuntimeConfig, createDemoCredential } from '@/config/demo-runtime';
import { getPublicApiConfig } from '@/config/public-api';
import { purgeForeignWalletSessions } from '@/wallet/account-scope';
import { createAccountScopedAppKit, walletRuntimeConfig } from '@/wallet/appkit';
import { listAppKitStorageKeys, removeAppKitStorageKeys } from '@/wallet/appkit-storage';
import { forgetWalletSession } from '@/wallet/forget-wallet-session';

type DemoState = {
  status: 'demo';
  accountId: string;
  credential: Extract<AccountCredential, { kind: 'demo' }>;
};

export type AuthSessionState = AuthState | DemoState | {
  status: 'signedOut';
  reason: 'CONFIGURATION_REQUIRED';
};

type AppKitInstance = NonNullable<ReturnType<typeof createAccountScopedAppKit>>;

export type AuthSessionContextValue = {
  state: AuthSessionState;
  accountId?: string;
  credential?: AccountCredential;
  session?: StoredAuthSessionV1;
  appKit: AppKitInstance | null;
  canSignIn: boolean;
  destructiveReauthentication: 'BLOCKED' | 'DEMO_ALLOWED';
  signIn(): Promise<void>;
  logout(): Promise<void>;
  switchAccount(): Promise<void>;
  invalidateSession(): Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

const authConfiguration = getAuthConfiguration({
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});
const publicApiConfiguration = getPublicApiConfig({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});
const developmentBuild = Application.applicationId !== 'kr.masscom.wolgye';
const productionAuthAvailable = authConfiguration.available && publicApiConfiguration.available;

function initialAuthState(): AuthSessionState {
  if (productionAuthAvailable) return { status: 'restoring' };
  if (developmentBuild && demoRuntimeConfig.customerAccountId) {
    return {
      status: 'demo',
      accountId: demoRuntimeConfig.customerAccountId,
      credential: createDemoCredential(
        demoRuntimeConfig.customerAccountId,
        demoRuntimeConfig.allowInsecureDemoReauthentication,
      ),
    };
  }
  return { status: 'signedOut', reason: 'CONFIGURATION_REQUIRED' };
}

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthSessionState>(initialAuthState);
  const controllerRef = useRef<ReturnType<typeof createAuthController> | undefined>(undefined);
  const lastAppKitRef = useRef<AppKitInstance | null>(null);

  useEffect(() => {
    if (!authConfiguration.available || !publicApiConfiguration.available) return;

    nativeGoogleSignIn.configure(authConfiguration.webClientId);
    const controller = createAuthController({
      sessionStore: createSessionStore(SecureStore),
      authApi: new AuthApiClient({ apiUrl: publicApiConfiguration.apiUrl }),
      google: nativeGoogleSignIn,
      clearWalletSession: async () => {
        await forgetWalletSession({
          disconnect: async () => {
            await lastAppKitRef.current?.disconnect('eip155');
          },
          listStoredKeys: listAppKitStorageKeys,
          removeStoredKeys: removeAppKitStorageKeys,
        });
      },
      publish: setState,
    });
    controllerRef.current = controller;
    void controller.restore();
  }, []);

  const accountId = state.status === 'signedIn'
    ? state.session.accountId
    : state.status === 'demo'
      ? state.accountId
      : undefined;
  const credential = state.status === 'signedIn' || state.status === 'demo'
    ? state.credential
    : undefined;
  const session = state.status === 'signedIn' ? state.session : undefined;
  const appKit = useMemo(
    () => accountId ? createAccountScopedAppKit(walletRuntimeConfig, accountId) : null,
    [accountId],
  );

  useEffect(() => {
    if (appKit) lastAppKitRef.current = appKit;
  }, [appKit]);

  useEffect(() => {
    if (!accountId) return;
    void purgeForeignWalletSessions({
      accountId,
      listStoredKeys: listAppKitStorageKeys,
      removeStoredKeys: removeAppKitStorageKeys,
    });
  }, [accountId]);

  const value = useMemo<AuthSessionContextValue>(() => ({
    state,
    accountId,
    credential,
    session,
    appKit,
    canSignIn: productionAuthAvailable,
    destructiveReauthentication:
      state.status === 'demo' && state.credential.allowInsecureReauthentication
        ? 'DEMO_ALLOWED'
        : 'BLOCKED',
    async signIn() {
      if (!controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      await controllerRef.current.signIn();
    },
    async logout() {
      if (state.status === 'demo') {
        await forgetWalletSession({
          disconnect: async () => {
            await lastAppKitRef.current?.disconnect('eip155');
          },
          listStoredKeys: listAppKitStorageKeys,
          removeStoredKeys: removeAppKitStorageKeys,
        });
        return;
      }
      await controllerRef.current?.logout();
    },
    async switchAccount() {
      if (!controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      await controllerRef.current.switchAccount();
    },
    async invalidateSession() {
      if (!session || !controllerRef.current) return;
      await controllerRef.current.invalidateSession(session.sessionToken);
    },
  }), [accountId, appKit, credential, session, state]);

  return <AuthSessionContext value={value}>{children}</AuthSessionContext>;
}

export function useAuthSession(): AuthSessionContextValue {
  const value = use(AuthSessionContext);
  if (!value) throw new Error('useAuthSession must be used inside AuthSessionProvider');
  return value;
}
