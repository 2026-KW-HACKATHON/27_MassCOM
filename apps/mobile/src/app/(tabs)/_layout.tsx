import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { FloatingTabBar } from '@/navigation/floating-tab-bar';
import { worldForScheme } from '@/theme/world';

export default function PrimaryTabLayout() {
  const world = worldForScheme(useColorScheme());

  return (
    <Tabs
      // 내 정보 is reached from the header avatar; going back should return to the tab the person came from.
      backBehavior="history"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: world.page } }}
    >
      <Tabs.Screen name="index" options={{ title: '탐색', tabBarAccessibilityLabel: '탐색' }} />
      <Tabs.Screen name="map" options={{ title: '지도', tabBarAccessibilityLabel: '지도' }} />
      <Tabs.Screen name="claim" options={{ title: '방문 인증', tabBarAccessibilityLabel: '방문 인증' }} />
      <Tabs.Screen name="collection" options={{ title: '도감', tabBarAccessibilityLabel: '도감' }} />
      <Tabs.Screen name="settings" options={{ title: '내 정보', href: null }} />
    </Tabs>
  );
}
