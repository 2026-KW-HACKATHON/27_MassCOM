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
      initialRouteName="index"
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: world.page } }}
    >
      <Tabs.Screen name="search" options={{ title: '탐색', tabBarAccessibilityLabel: '탐색' }} />
      <Tabs.Screen name="collection" options={{ title: '도감', tabBarAccessibilityLabel: '도감' }} />
      <Tabs.Screen name="index" options={{ title: '홈', tabBarAccessibilityLabel: '홈' }} />
      <Tabs.Screen name="play-tab" options={{ title: '놀이', tabBarAccessibilityLabel: '놀이' }} />
      <Tabs.Screen name="shop" options={{ title: '상점', tabBarAccessibilityLabel: '상점' }} />
      <Tabs.Screen name="shop-again" options={{ title: '상점', href: null }} />
      <Tabs.Screen name="map" options={{ title: '지도', href: null }} />
      <Tabs.Screen name="claim" options={{ title: '방문 인증', href: null }} />
      {/* #298: 친구는 탭에서 빠지고 홈 헤더·내 정보에서 들어간다(화면·/friends 경로는 그대로 유지). */}
      <Tabs.Screen name="friends" options={{ title: '친구', href: null }} />
      <Tabs.Screen name="settings" options={{ title: '내 정보', href: null }} />
    </Tabs>
  );
}
