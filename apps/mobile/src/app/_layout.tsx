import { AppKit, AppKitProvider } from '@reown/appkit-react-native';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import { View } from 'react-native';

import { demoRuntimeConfig } from '@/config/demo-runtime';
import { purgeForeignWalletSessions } from '@/wallet/account-scope';
import { appKit } from '@/wallet/appkit';
import { listAppKitStorageKeys, removeAppKitStorageKeys } from '@/wallet/appkit-storage';

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
  const accountId = demoRuntimeConfig.customerAccountId;
  useEffect(() => {
    if (!accountId) return;
    // Hygiene only: scoped storage already keeps another account's session from being read.
    purgeForeignWalletSessions({
      accountId,
      listStoredKeys: listAppKitStorageKeys,
      removeStoredKeys: removeAppKitStorageKeys,
    }).catch((error: unknown) => {
      console.error('wallet session cleanup failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
    });
  }, [accountId]);

  if (!appKit) {
    return <Routes />;
  }

  return (
    <AppKitProvider instance={appKit}>
      <Routes />
      <View pointerEvents="box-none" style={{ position: 'absolute', width: '100%', height: '100%' }}>
        <AppKit />
      </View>
    </AppKitProvider>
  );
}
