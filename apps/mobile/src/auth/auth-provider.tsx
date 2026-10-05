import { getAppPackageId } from '@/config/app-identity';
import Constants from 'expo-constants';
import { createContext, type PropsWithChildren, use, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { AccountCredential } from './account-credential';
import { AuthApiClient } from './auth-api';
import { getAuthConfiguration } from './auth-config';
import { createAuthController } from './auth-controller';
import { resolveAuthStartup, type AuthSessionState } from './auth-startup';
import { nativeGoogleSignIn } from './google-sign-in-runtime';
import { platformSecureStore } from './platform-secure-store';
import { createSessionStore, type StoredAuthSessionV1 } from './session-store';
import { demoRuntimeConfig, isDevelopmentDemoBuild } from '@/config/demo-runtime';
import { isApprovedGuestTrialOrigin } from '@/config/guest-trial-origin';
import { isGuestTrialAvailable } from './guest-trial-availability';
import { getPublicApiConfig } from '@/config/public-api';
import { resolveRuntimeIdentity } from '@/config/showcase-identity';
import { consumeMerchantReturn } from '@/navigation/showcase-entry';
import { clearPendingFriendLink } from '@/friends/pending-friend-link';
import { purgeForeignCollectionPrefs } from '@/screens/collection/collection-prefs';
import { listCollectionPrefKeys, removeCollectionPrefKeys } from '@/screens/collection/collection-prefs-storage';
import { appVariantForPackage, beginSocialPushBindingRevocation, revokeSocialPushBindings } from '@/social/push-runtime';
import { purgeForeignWalletSessions } from '@/wallet/account-scope';
import { createAccountScopedAppKit, walletRuntimeConfig } from '@/wallet/appkit';
import { listAppKitStorageKeys, removeAppKitStorageKeys } from '@/wallet/appkit-storage';
import { forgetWalletSession } from '@/wallet/forget-wallet-session';

export type { AuthSessionState } from './auth-startup';

type AppKitInstance = NonNullable<ReturnType<typeof createAccountScopedAppKit>>;

export type AuthSessionContextValue = {
  state: AuthSessionState;
  accountId?: string;
  credential?: AccountCredential;
  session?: StoredAuthSessionV1;
  appKit: AppKitInstance | null;
  canSignIn: boolean;
  canStartGuestTrial: boolean;
  destructiveReauthentication: 'BLOCKED' | 'DEMO_ALLOWED';
  signIn(): Promise<void>;
  signInAsGuest(): Promise<void>;
  restartGuestTrial(): Promise<void>;
  logout(): Promise<void>;
  switchAccount(): Promise<void>;
  invalidateSession(): Promise<void>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | undefined>(undefined);

const runtimeIdentity = resolveRuntimeIdentity(
  getAppPackageId(),
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
const developmentBuild = isDevelopmentDemoBuild(getAppPackageId());
// Google 로그인은 네이티브 전용(react-native-nitro-google-signin에 웹 빌드가 없다).
const isWeb = Platform.OS === 'web';
const productionAuthAvailable = !isWeb && authConfiguration.available && publicApiConfiguration.available;
// 체험 로그인은 승인된 시연·개발 빌드 전용이다: 패키지와 API origin이 서로 맞물려야 한다
// (실제 시연 빌드 ↔ 실제 시연 API, 로컬 개발 빌드 ↔ loopback API만). 둘 중 하나라도 안 맞으면 웹에서도
// 체험 로그인을 열지 않는다 — 안 맞는 조합으로 web export 자체가 안 되는 build-environment 검사와
// 별개로, 로컬 `expo start --web` 같은 경로를 통해서도 새지 않게 막는 2차 방어선이다.
const guestTrialAvailable = isGuestTrialAvailable({
  packageId: getAppPackageId(),
  platform: isWeb ? 'web' : 'native',
  demoAccountInjected: Boolean(demoRuntimeConfig.customerAccountId),
  productionAuthAvailable,
  publicApiAvailable: publicApiConfiguration.available,
  approvedOrigin: publicApiConfiguration.available && isApprovedGuestTrialOrigin(
    getAppPackageId(), publicApiConfiguration.apiUrl, Constants.expoConfig?.extra,
  ),
});

const startup = resolveAuthStartup({
  productionAuthAvailable,
  guestTrialAvailable,
  developmentBuild,
  customerAccountId: demoRuntimeConfig.customerAccountId,
  allowInsecureDemoReauthentication: demoRuntimeConfig.allowInsecureDemoReauthentication,
  isWeb,
});

async function revokeSocialPushBindingForAuthSession(accountId?: string, credential?: AccountCredential): Promise<void> {
  beginSocialPushBindingRevocation();
  await revokeSocialPushBindings({
    apiUrl: publicApiConfiguration.available ? publicApiConfiguration.apiUrl : undefined,
    accountId,
    credential,
    appVariant: appVariantForPackage(getAppPackageId()),
  });
}


export function AuthSessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthSessionState>(startup.initialState);
  const controllerRef = useRef<ReturnType<typeof createAuthController> | undefined>(undefined);
  const lastAppKitRef = useRef<AppKitInstance | null>(null);

  useEffect(() => {
    if (!publicApiConfiguration.available) return;
    if (!startup.createController) return;
    if (productionAuthAvailable && authConfiguration.available) {
      nativeGoogleSignIn.configure(authConfiguration.webClientId);
    }
    const controller = createAuthController({
      sessionStore: createSessionStore(platformSecureStore),
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
      beforeGuestTrialRestart: async (restartingSession) => {
        await revokeSocialPushBindingForAuthSession(restartingSession.accountId, { kind: 'bearer', sessionToken: restartingSession.sessionToken });
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

  const value = useMemo<AuthSessionContextValue>(() => ({
    state,
    accountId,
    credential,
    session,
    appKit,
    canSignIn: productionAuthAvailable,
    canStartGuestTrial: guestTrialAvailable,
    destructiveReauthentication:
      state.status === 'demo' && state.credential.allowInsecureReauthentication
        ? 'DEMO_ALLOWED'
        : 'BLOCKED',
    async signIn() {
      if (!controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      await controllerRef.current.signIn();
    },
    async signInAsGuest() {
      if (!guestTrialAvailable || !controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      await controllerRef.current.signInAsGuest();
    },
    async restartGuestTrial() {
      if (!guestTrialAvailable || !session?.guest || !controllerRef.current) {
        throw new Error('AUTH_CONFIGURATION_REQUIRED');
      }
      clearPendingFriendLink();
      consumeMerchantReturn();
      await controllerRef.current.restartGuestTrial();
    },
    async logout() {
      // A friend link opened under this account must not be offered to whoever signs in next.
      clearPendingFriendLink();
      const previousAccountId = accountId;
      const previousCredential = credential;
      await revokeSocialPushBindingForAuthSession(previousAccountId, previousCredential);
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
      clearPendingFriendLink();
      const previousAccountId = accountId;
      const previousCredential = credential;
      await revokeSocialPushBindingForAuthSession(previousAccountId, previousCredential);
      if (!controllerRef.current) throw new Error('AUTH_CONFIGURATION_REQUIRED');
      await controllerRef.current.switchAccount();
    },
    async invalidateSession() {
      clearPendingFriendLink();
      const previousAccountId = accountId;
      const previousCredential = credential;
      await revokeSocialPushBindingForAuthSession(previousAccountId, previousCredential);
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
