import { AppKit, AppKitProvider } from '@reown/appkit-react-native';
import { Stack } from 'expo-router/stack';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthSessionProvider, useAuthSession } from '@/auth/auth-provider';
import { AuthRequiredScreen } from '@/screens/auth-required';

function Routes() {
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="index" options={{ title: '월계 맛길' }} />
      <Stack.Screen name="merchants/[merchantId]" options={{ title: '음식점 상세' }} />
      <Stack.Screen name="claim" options={{ title: '방문 수령' }} />
      <Stack.Screen name="collection" options={{ title: '나의 도감' }} />
      <Stack.Screen name="merchant" options={{ title: '점주 방문 확인' }} />
      <Stack.Screen name="recommendations" options={{ title: '다음 가게 추천' }} />
      <Stack.Screen name="wallet" options={{ title: '외부 지갑 연결' }} />
      <Stack.Screen name="settings" options={{ title: '계정·개인정보' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthSessionProvider>
        <AuthenticatedRoot />
      </AuthSessionProvider>
    </SafeAreaProvider>
  );
}

function AuthenticatedRoot() {
  const auth = useAuthSession();

  if (auth.state.status !== 'signedIn' && auth.state.status !== 'demo') {
    return (
      <AuthRequiredScreen
        state={auth.state}
        canSignIn={auth.canSignIn}
        onSignIn={auth.signIn}
      />
    );
  }

  if (!auth.appKit) return <Routes key={auth.accountId} />;

  return (
    <AppKitProvider key={auth.accountId} instance={auth.appKit}>
      <Routes />
      <View pointerEvents="box-none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <AppKit />
      </View>
    </AppKitProvider>
  );
}
