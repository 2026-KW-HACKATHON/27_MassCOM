import { getAppPackageId } from '@/config/app-identity';
import { AppKit, AppKitProvider, useAppKitTheme } from '@reown/appkit-react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/auth/auth-provider';
import { AuthRequiredScreen } from '@/screens/auth-required';
import { SignInActions } from '@/screens/auth-required/sign-in-actions';
import { ConsentScreen } from '@/screens/consent';
import { publicApiConfig } from '@/config/public-api-runtime';
import { shouldAskConsent } from '@/privacy/consent-flow';
import { hasPendingFriendLink } from '@/friends/pending-friend-link';
import { initializeUiSounds } from '@/sound/ui-sounds';
import { consumeMerchantReturn, reconcileShowcaseAccount, showcaseEntryDestination, type ShowcaseRoleState } from '@/navigation/showcase-entry';
import { FoundationScreen } from '@/screens/foundation';
import { ShowcaseMerchantScreen } from '@/screens/showcase-merchant';
import { colorsForScheme } from '@/theme/palette';

function Routes() {
  const auth = useAuthSession();
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  useEffect(() => {
    if (auth.state.status !== 'signedIn') return;
    const merchantId = consumeMerchantReturn();
    if (merchantId) router.replace({ pathname: '/merchants/[merchantId]', params: { merchantId } });
    // A friend link opened while signed out continues at the friends tab, which asks about the code or says why it cannot be used
    // (it consumes it there).
    else if (hasPendingFriendLink()) router.replace('/friends');
  }, [auth.state.status, router]);
  return (
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
      <Stack.Screen name="foundation-preview" options={{ title: 'UI 시안 미리보기' }} />
      <Stack.Screen name="showcase-tour" options={{ title: '체험용 다섯 공간' }} />
      <Stack.Screen name="merchants/[merchantId]" options={{ headerShown: false }} />
      <Stack.Screen name="friends/[friendshipId]" options={{ headerShown: false }} />
      <Stack.Screen name="merchant" options={{ title: '점주 방문 확인' }} />
      <Stack.Screen name="merchant-art" options={{ headerShown: false }} />
      <Stack.Screen name="recommendations" options={{ headerShown: false }} />
      <Stack.Screen name="wallet" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => initializeUiSounds(), []);
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthSessionProvider>
        <AuthenticatedRoot />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

function AuthenticatedRoot() {
  const auth = useAuthSession();
  const themeMode = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [entry, setEntry] = useState<ShowcaseRoleState>({});
  // 이 실행에서 서버가 "이미 동의했다"고 답한 계정. 기기에는 저장하지 않고 실행마다 서버에 다시 묻는다(D-059).
  const [consentedAccountId, setConsentedAccountId] = useState<string>();
  const acceptConsent = useCallback(() => setConsentedAccountId(auth.accountId), [auth.accountId]);
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
      authActions={auth.state.status !== 'signedIn' && auth.state.status !== 'demo' ? (
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
      apiAvailable: publicApiConfig.available, consentedAccountId,
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
      onLogout={auth.logout}
      onSessionInvalid={auth.invalidateSession}
    />;
  }

  if (!auth.appKit) return <Routes />;

  return (
    <AppKitProvider key={auth.accountId} instance={auth.appKit}>
      <WalletThemeSynchronizer themeMode={themeMode} />
      <Routes />
      <View pointerEvents="box-none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <AppKit />
      </View>
    </AppKitProvider>
  );
}

function WalletThemeSynchronizer({ themeMode }: { themeMode: 'light' | 'dark' }) {
  const { setThemeMode } = useAppKitTheme();
  useEffect(() => setThemeMode(themeMode), [setThemeMode, themeMode]);
  return null;
}
