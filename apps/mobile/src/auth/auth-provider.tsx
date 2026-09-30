import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createContext, type PropsWithChildren, use, useEffect, useMemo, useRef, useState } from 'react';

import type { AccountCredential } from './account-credential';
import { AuthApiClient } from './auth-api';
import { getAuthConfiguration } from './auth-config';
import { createAuthController, type AuthState } from './auth-controller';
import { nativeGoogleSignIn } from './google-sign-in-runtime';
import { createSessionStore, type StoredAuthSessionV1 } from './session-store';
import { demoRuntimeConfig, createDemoCredential, isDevelopmentDemoBuild } from '@/config/demo-runtime';
import { getPublicApiConfig } from '@/config/public-api';
import { resolveRuntimeIdentity } from '@/config/showcase-identity';
import { clearPendingFriendLink } from '@/friends/pending-friend-link';
import { purgeForeignCollectionPrefs, purgeOwnCollectionPrefs } from '@/screens/collection/collection-prefs';
import { listCollectionPrefKeys, removeCollectionPrefKeys } from '@/screens/collection/collection-prefs-storage';
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

const runtimeIdentity = resolveRuntimeIdentity(
  Application.applicationId,
  Constants.expoConfig?.extra,
  {
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    reownProjectId: process.env.EXPO_PUBLIC_REOWN_PROJECT_ID,
  },
);
const authConfiguration = getAuthConfiguration({
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: runtimeIdentity.googleWebClientId,
});
const publicApiConfiguration = getPublicApiConfig({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});
const developmentBuild = isDevelopmentDemoBuild(Application.applicationId);
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

  // 아래 purge 호출이 list 조회 중 계정이 다시 바뀌어도, 그 시점에 가장 최근 accountId가 무엇인지 확인할 수 있게 한다.
  const latestAccountIdRef = useRef(accountId);
  useEffect(() => {
    latestAccountIdRef.current = accountId;
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    void purgeForeignWalletSessions({
      accountId,
      listStoredKeys: listAppKitStorageKeys,
      removeStoredKeys: removeAppKitStorageKeys,
    });
    // 대표 진열·마스코트 반응 기록도 지갑 세션처럼 계정이 바뀌면 이전 계정 몫을 지운다. isStillCurrent는 이 조회가 끝나기 전에
    // 계정이 또 바뀌었을 때(빠른 전환) 그 사이 새 계정이 쓴 키를 "다른 계정 것"으로 오인해 지우지 않게 막는다.
    void purgeForeignCollectionPrefs({
      accountId,
      listStoredKeys: listCollectionPrefKeys,
      removeStoredKeys: removeCollectionPrefKeys,
      isStillCurrent: () => latestAccountIdRef.current === accountId,
    });
  }, [accountId]);

  // 로그아웃·계정 전환·세션 무효화로 이 계정을 떠날 때 그 계정의 대표 진열·마스코트 반응 기록을 지운다. 그래야 같은 계정으로
  // 다시 로그인했을 때 지운 적 없는 값이 조용히 되살아나지 않는다(지갑 세션은 forgetWalletSession이 이미 이렇게 한다).
  async function purgeOutgoingCollectionPrefs(outgoingAccountId: string | undefined) {
    if (!outgoingAccountId) return;
    await purgeOwnCollectionPrefs({
      accountId: outgoingAccountId,
      listStoredKeys: listCollectionPrefKeys,
      removeStoredKeys: removeCollectionPrefKeys,
    });
  }

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
      // A friend link opened under this account must not be offered to whoever signs in next.
      clearPendingFriendLink();
      const outgoingAccountId = accountId;
      if (state.status === 'demo') {
        await forgetWalletSession({
          disconnect: async () => {
            await lastAppKitRef.current?.disconnect('eip155');
          },
          listStoredKeys: listAppKitStorageKeys,
          removeStoredKeys: removeAppKitStorageKeys,
        });
        await purgeOutgoingCollectionPrefs(outgoingAccountId);
        return;
      }
      await controllerRef.current?.logout();
      await purgeOutgoingCollectionPrefs(outgoingAccountId);
    },
    async switchAccount() {
      clearPendingFriendLink();
      if (!controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      const outgoingAccountId = accountId;
      await controllerRef.current.switchAccount();
      await purgeOutgoingCollectionPrefs(outgoingAccountId);
    },
    async invalidateSession() {
      clearPendingFriendLink();
      if (!session || !controllerRef.current) return;
      const outgoingAccountId = accountId;
      await controllerRef.current.invalidateSession(session.sessionToken);
      await purgeOutgoingCollectionPrefs(outgoingAccountId);
    },
  }), [accountId, appKit, credential, session, state]);

  return <AuthSessionContext value={value}>{children}</AuthSessionContext>;
}

export function useAuthSession(): AuthSessionContextValue {
  const value = use(AuthSessionContext);
  if (!value) throw new Error('useAuthSession must be used inside AuthSessionProvider');
  return value;
}
