import './global.css';

import { getAppPackageId } from '@/config/app-identity';
import Constants from 'expo-constants';
import { AppKit, AppKitProvider, useAppKitTheme } from '@reown/appkit-react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/auth/auth-provider';
import { AuthRequiredScreen } from '@/screens/auth-required';
import { SignInActions } from '@/screens/auth-required/sign-in-actions';
import { ConsentScreen } from '@/screens/consent';
import { publicApiConfig } from '@/config/public-api-runtime';
import { shouldAskConsent } from '@/privacy/consent-flow';
import { ConsentRecheckProvider } from '@/privacy/consent-recheck';
import { hasPendingFriendLink } from '@/friends/pending-friend-link';
import { initializeUiSounds, setUiSoundSessionActive } from '@/sound/ui-sounds';
import { consumeInternalAuthReturn, reconcileShowcaseAccount, showcaseEntryDestination, showShowcaseRoleEntry, type ShowcaseRoleState } from '@/navigation/showcase-entry';
import { ShowcaseRoleReturnContext } from '@/navigation/showcase-role-context';
import { FoundationScreen } from '@/screens/foundation';
import { ShowcaseMerchantScreen } from '@/screens/showcase-merchant';
import { SocialPushProvider } from '@/social/push-runtime';
import { ContextTabBar } from '@/navigation/context-tab-bar';
import { TabAppearanceProvider } from '@/navigation/tab-appearance-provider';
import { DiscoveryProvider } from '@/discovery/discovery-provider';
import { colorsForScheme } from '@/theme/palette';
import { worldForScheme } from '@/theme/world';
import { NotificationSessionBridge } from '@/notifications/session-bridge';
import { consumeMerchantNotificationRole, consumeNotificationTarget, subscribeMerchantNotificationRole, subscribeNotificationTarget } from '@/notifications/pending-target';

function expoProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra;
  const eas = extra && typeof extra === 'object' && 'eas' in extra
    ? (extra as { eas?: { projectId?: unknown } }).eas
    : undefined;
  const projectId = eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : undefined;
}

function Routes() {
  const [contextFootprint, setContextFootprint] = useState(0);
  const auth = useAuthSession();
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const projectId = expoProjectId();
  const openMail = useCallback((mailId: string) => {
    if (!auth.accountId || !auth.credential) return;
    router.push({ pathname: '/mail/[mailId]', params: { mailId } });
  }, [auth.accountId, auth.credential, router]);
  useEffect(() => {
    // The development build signs in with a demo credential, and the 1-person-2-roles handoff returns through here too.
    if (auth.state.status !== 'signedIn' && auth.state.status !== 'demo') return;
    const target = consumeInternalAuthReturn();
    if (target) router.replace(target);
    // A friend link opened while signed out continues at the friends tab, which asks about the code or says why it cannot be used
    // (it consumes it there).
    else if (hasPendingFriendLink()) router.replace('/friends');
  }, [auth.state.status, router]);
  useEffect(() => {
    if (!auth.accountId) return;
    const accountId = auth.accountId;
    const openPending = () => {
      const target = consumeNotificationTarget(accountId);
      if (target) router.push(target as never);
    };
    const unsubscribe = subscribeNotificationTarget(openPending);
    openPending();
    return unsubscribe;
  }, [auth.accountId, router]);
  return (
    <SocialPushProvider
      apiUrl={publicApiConfig.available ? publicApiConfig.apiUrl : undefined}
      accountId={auth.accountId}
      credential={auth.credential}
      projectId={projectId}
      onSessionInvalid={auth.invalidateSession}
      onOpenMail={openMail}
    >
      <View style={{ flex: 1, paddingBottom: contextFootprint, backgroundColor: world.page }}>
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: palette.surface },
          headerTintColor: palette.label,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="merchants/[merchantId]" options={{ headerShown: false }} />
        <Stack.Screen name="friends/[friendshipId]" options={{ headerShown: false }} />
        <Stack.Screen name="friends/[friendshipId]/studio" options={{ headerShown: false }} />
        <Stack.Screen name="friends/[friendshipId]/message" options={{ headerShown: false }} />
        <Stack.Screen name="friends/[friendshipId]/meal-invite" options={{ headerShown: false }} />
        <Stack.Screen name="mail/index" options={{ headerShown: false }} />
        <Stack.Screen name="mail/[mailId]" options={{ headerShown: false }} />
        <Stack.Screen name="meal-merchant" options={{ headerShown: false }} />
        <Stack.Screen name="home/missions" options={{ headerShown: false }} />
        <Stack.Screen name="home/tickets" options={{ headerShown: false }} />
        <Stack.Screen name="home/exhibit" options={{ headerShown: false }} />
        <Stack.Screen name="studio" options={{ headerShown: false }} />
        <Stack.Screen name="appearance" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="room-inventory" options={{ headerShown: false }} />
        <Stack.Screen name="play" options={{ headerShown: false }} />
        <Stack.Screen name="merchant" options={{ title: '점주 방문 확인' }} />
        <Stack.Screen name="merchant-art" options={{ headerShown: false }} />
        <Stack.Screen name="coin-shop" options={{ headerShown: false }} />
        <Stack.Screen name="coin-collection" options={{ headerShown: false }} />
        <Stack.Screen name="room-explore" options={{ headerShown: false }} />
        <Stack.Screen name="recommendations" options={{ headerShown: false }} />
        <Stack.Screen name="courses/index" options={{ headerShown: false }} />
        <Stack.Screen name="courses/[courseId]" options={{ headerShown: false }} />
        <Stack.Screen name="wallet" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ title: '알림함' }} />
      </Stack>
      <ContextTabBar onFootprint={setContextFootprint} />
      </View>
    </SocialPushProvider>
  );
}

export default function RootLayout() {
  useEffect(() => initializeUiSounds(), []);
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthSessionProvider>
        <NotificationSessionBridge />
        <AccountAppearance />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

function AccountAppearance() {
  const auth = useAuthSession();
  useEffect(() => {
    setUiSoundSessionActive(Boolean(auth.accountId));
  }, [auth.accountId]);
  // Above the stack and the showcase merchant screen: every BackHeader/AppHeader profile strip, inside or outside (tabs), reads the
  // same discovery answers. It asks nothing until a strip gains focus, so the consent screen makes no request.
  return <TabAppearanceProvider accountId={auth.accountId}>
    <DiscoveryProvider
      apiUrl={publicApiConfig.available ? publicApiConfig.apiUrl : undefined}
      accountId={auth.accountId}
      credential={auth.credential}
      onSessionInvalid={auth.invalidateSession}
    >
      <AuthenticatedRoot />
    </DiscoveryProvider>
  </TabAppearanceProvider>;
}

function AuthenticatedRoot() {
  const auth = useAuthSession();
  const themeMode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [entry, setEntry] = useState<ShowcaseRoleState>({});
  const returnToRole = useCallback(() => setEntry({ accountId: auth.accountId }), [auth.accountId]);
  useEffect(() => {
    if (!auth.accountId) return;
    const accountId = auth.accountId;
    const openMerchant = () => {
      if (consumeMerchantNotificationRole(accountId)) setEntry({ role: 'merchant', accountId });
    };
    const unsubscribe = subscribeMerchantNotificationRole(openMerchant);
    openMerchant();
    return unsubscribe;
  }, [auth.accountId]);
  // 이 실행에서 서버가 "이미 동의했다"고 답한 계정. 기기에는 저장하지 않고 실행마다 서버에 다시 묻는다(D-059).
  const [consentedAccountId, setConsentedAccountId] = useState<string>();
  const acceptConsent = useCallback(() => setConsentedAccountId(auth.accountId), [auth.accountId]);
  // DEMO 계정은 처음에는 묻지 않지만, 서버가 동의를 요구해 "동의 확인하기"를 누르면 이 계정에 한해 같은 화면을 연다.
  const [recheckRequestedAccountId, setRecheckRequestedAccountId] = useState<string>();
  const recheckConsent = useCallback(() => {
    setConsentedAccountId(undefined);
    setRecheckRequestedAccountId(auth.accountId);
  }, [auth.accountId]);
  const activeEntry = reconcileShowcaseAccount(entry, auth.accountId);
  if (activeEntry !== entry) {
    setEntry(activeEntry);
    return null;
  }

  const destination = showcaseEntryDestination(
    getAppPackageId(),
    activeEntry.role,
    auth.state.status === 'signedIn' || auth.state.status === 'demo',
  );

  if (destination === 'role') {
    return <FoundationScreen
      onChooseRole={(role) => setEntry({ role, accountId: auth.accountId })}
      // 웹 체험은 역할을 고른 뒤 로그인 필요 화면에서 시작하던 흐름을 그대로 둔다(#365 검토). 여기 단추는 네이티브 시연 앱만 쓴다.
      authActions={Platform.OS !== 'web' && auth.state.status !== 'signedIn' && auth.state.status !== 'demo' ? (
        <SignInActions
          state={auth.state}
          canSignIn={auth.canSignIn}
          canStartGuestTrial={auth.canStartGuestTrial}
          onSignIn={auth.signIn}
          onGuestSignIn={auth.signInAsGuest}
        />
      ) : undefined}
    />;
  }

  if (destination === 'auth' && auth.state.status !== 'signedIn' && auth.state.status !== 'demo') {
    return (
      <AuthRequiredScreen
        state={auth.state}
        canSignIn={auth.canSignIn}
        canStartGuestTrial={auth.canStartGuestTrial}
        onSignIn={auth.signIn}
        onGuestSignIn={auth.signInAsGuest}
        onBackToRole={getAppPackageId() === 'kr.masscom.wolgye.demo'
          ? () => setEntry({ accountId: auth.accountId }) : undefined}
      />
    );
  }

  // 첫 로그인 동의(운영·시연 공통, Issue #253): 서버가 required라고 하면 점주 화면과 메인 탭보다 먼저 전체 화면으로 묻는다.
  if (
    auth.accountId && auth.credential && publicApiConfig.available && shouldAskConsent({
      status: auth.state.status, accountId: auth.accountId, credential: auth.credential,
      apiAvailable: publicApiConfig.available, consentedAccountId, recheckRequestedAccountId,
    })
  ) {
    return <ConsentScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.apiUrl}
      credential={auth.credential}
      onAccepted={acceptConsent}
      onLogout={auth.logout}
      onSessionInvalid={auth.invalidateSession}
    />;
  }

  if (destination === 'merchant' && auth.accountId && auth.credential) {
    return <ShowcaseMerchantScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.available ? publicApiConfig.apiUrl : undefined}
      accountId={auth.accountId}
      credential={auth.credential}
      onBrowse={() => setEntry({ role: 'customer', accountId: auth.accountId })}
      onReturnToRole={returnToRole}
      onLogout={auth.logout}
      onSessionInvalid={auth.invalidateSession}
    />;
  }

  return (
    <ShowcaseRoleReturnContext.Provider value={showShowcaseRoleEntry(getAppPackageId()) ? returnToRole : undefined}>
      {!auth.appKit ? <ConsentRecheckProvider onRecheck={recheckConsent}><Routes /></ConsentRecheckProvider> : (
        <AppKitProvider key={auth.accountId} instance={auth.appKit}>
          <WalletThemeSynchronizer themeMode={themeMode} />
          <ConsentRecheckProvider onRecheck={recheckConsent}><Routes /></ConsentRecheckProvider>
          <View pointerEvents="box-none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
            <AppKit />
          </View>
        </AppKitProvider>
      )}
    </ShowcaseRoleReturnContext.Provider>
  );
}

function WalletThemeSynchronizer({ themeMode }: { themeMode: 'light' | 'dark' }) {
  const { setThemeMode } = useAppKitTheme();
  useEffect(() => setThemeMode(themeMode), [setThemeMode, themeMode]);
  return null;
}
