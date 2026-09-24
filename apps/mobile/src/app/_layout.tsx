import * as Application from 'expo-application';
import { AppKit, AppKitProvider, useAppKitTheme } from '@reown/appkit-react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/auth/auth-provider';
import { AuthRequiredScreen } from '@/screens/auth-required';
import { publicApiConfig } from '@/config/public-api-runtime';
import { reconcileShowcaseAccount, showcaseEntryDestination, type ShowcaseRoleState } from '@/navigation/showcase-entry';
import { FoundationScreen } from '@/screens/foundation';
import { ShowcaseMerchantScreen } from '@/screens/showcase-merchant';
import { colorsForScheme } from '@/theme/palette';

function Routes() {
  const palette = colorsForScheme(useColorScheme());
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
      <Stack.Screen name="merchants/[merchantId]" options={{ title: '음식점 상세' }} />
      <Stack.Screen name="merchant" options={{ title: '점주 방문 확인' }} />
      <Stack.Screen name="recommendations" options={{ title: '다음 가게 추천' }} />
      <Stack.Screen name="wallet" options={{ title: '외부 지갑 연결' }} />
    </Stack>
  );
}

export default function RootLayout() {
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
  const activeEntry = reconcileShowcaseAccount(entry, auth.accountId);

  const destination = showcaseEntryDestination(
    Application.applicationId,
    activeEntry.role,
    auth.state.status === 'signedIn' || auth.state.status === 'demo',
  );

  if (destination === 'role') {
    return <FoundationScreen onChooseRole={(role) => setEntry({ role, accountId: auth.accountId })} />;
  }

  if (destination === 'auth' && auth.state.status !== 'signedIn' && auth.state.status !== 'demo') {
    return (
      <AuthRequiredScreen
        state={auth.state}
        canSignIn={auth.canSignIn}
        onSignIn={auth.signIn}
        onBackToRole={Application.applicationId === 'kr.masscom.wolgye.demo'
          ? () => setEntry({ accountId: auth.accountId }) : undefined}
      />
    );
  }

  if (destination === 'merchant' && auth.accountId && auth.credential) {
    return <ShowcaseMerchantScreen
      key={auth.accountId}
      apiUrl={publicApiConfig.available ? publicApiConfig.apiUrl : undefined}
      accountId={auth.accountId}
      credential={auth.credential}
      onBrowse={() => setEntry({ role: 'customer', accountId: auth.accountId })}
    />;
  }

  if (!auth.appKit) return <Routes key={auth.accountId} />;

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
