import { Tabs } from 'expo-router';
import { Text, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabGlyph } from '@/navigation/tab-glyph';
import { colorsForScheme } from '@/theme/palette';

export default function PrimaryTabLayout() {
  const palette = colorsForScheme(useColorScheme());
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.label,
        sceneStyle: { backgroundColor: palette.background },
        tabBarStyle: {
          backgroundColor: palette.surface,
          borderTopColor: palette.separator,
          ...(fontScale >= 1.5 ? { height: 64 + insets.bottom } : {}),
        },
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.secondaryLabel,
        tabBarLabel: ({ color, children }) => (
          <Text
            maxFontSizeMultiplier={1.25}
            numberOfLines={1}
            style={{ color, fontSize: 12, fontWeight: '700', textAlign: 'center' }}
          >
            {children}
          </Text>
        ),
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen
        name="explore"
        options={{
          title: '탐색',
          tabBarAccessibilityLabel: '탐색',
          tabBarIcon: ({ color, size }) => <TabGlyph name="explore" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="claim"
        options={{
          title: '방문 인증',
          tabBarAccessibilityLabel: '방문 인증',
          tabBarIcon: ({ color, size }) => <TabGlyph name="claim" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="collection"
        options={{
          title: '도감',
          tabBarAccessibilityLabel: '도감',
          tabBarIcon: ({ color, size }) => <TabGlyph name="collection" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '내 정보',
          tabBarAccessibilityLabel: '내 정보',
          tabBarIcon: ({ color, size }) => <TabGlyph name="account" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
