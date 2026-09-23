import { AppKit, AppKitProvider, useAppKitTheme } from '@reown/appkit-react-native';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/auth/auth-provider';
import { RouteBoundary, WalletBackButton } from '@/navigation/route-boundary';
import { colorsForScheme } from '@/theme/palette';

function Routes() {
  const palette = colorsForScheme(useColorScheme());
  return (
    <Stack
      screenLayout={({ children, route }) => <RouteBoundary name={route.name}>{children}</RouteBoundary>}
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.label,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="open" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="merchants/[merchantId]" options={{ title: '음식점 상세' }} />
      <Stack.Screen name="merchant" options={{ title: '점주 방문 확인' }} />
      <Stack.Screen name="recommendations" options={{ title: '다음 가게 추천' }} />
      <Stack.Screen name="wallet" options={{ title: '외부 지갑 연결', headerLeft: () => <WalletBackButton /> }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <AuthSessionProvider>
        <Routes />
        <WalletOverlay />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

function WalletOverlay() {
  const auth = useAuthSession();
  const themeMode = useColorScheme() === 'dark' ? 'dark' : 'light';

  if (!auth.appKit) return null;

  return (
    <AppKitProvider key={auth.accountId} instance={auth.appKit}>
      <WalletThemeSynchronizer themeMode={themeMode} />
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
