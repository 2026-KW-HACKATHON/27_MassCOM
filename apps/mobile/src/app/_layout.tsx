import { AppKit, AppKitProvider } from '@reown/appkit-react-native';
import { Stack } from 'expo-router/stack';
import { View } from 'react-native';

import { appKit } from '@/wallet/appkit';

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
      <Stack.Screen name="wallet" options={{ title: '외부 지갑 연결' }} />
    </Stack>
  );
}

export default function RootLayout() {
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
