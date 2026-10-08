import { usePathname, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { contextualTab, primaryDestinations } from './context-tabs';
import { tabAppearanceColors } from './tab-appearance';
import { useTabAppearance } from './tab-appearance-provider';
import { barHeightFor } from './tab-bar-style';
import { TabSlot, navigationLandmark } from './floating-tab-bar';

export function ContextTabBar({ onFootprint }: { onFootprint?: (height: number) => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const insideTabs = useSegments()[0] === '(tabs)';
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { appearance } = useTabAppearance();
  const colors = tabAppearanceColors(appearance, useColorScheme() === 'dark');
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const active = contextualTab(pathname);
  const footprint = active === null || keyboard ? 0 : barHeightFor(fontScale) + Math.max(8, insets.bottom) + 6;
  useEffect(() => { onFootprint?.(footprint); }, [footprint, onFootprint]);
  if (active === null || keyboard) return null;
  // role이 accessibilityRole보다 앞서므로 탭 목록 역할은 안쪽 View가 맡고, 바깥 View는 터치를 막지 않는다. 랜드마크 속성은 웹에서만 붙는다.
  return <View {...navigationLandmark} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
  <View accessibilityRole="tablist" style={{ position: 'absolute', left: 10, right: 10, bottom: Math.max(8, insets.bottom),
    flexDirection: 'row', height: barHeightFor(fontScale), padding: 5, borderRadius: 24, backgroundColor: colors.background,
    boxShadow: '0 3px 18px rgba(20, 56, 45, 0.10)' }}>
    {primaryDestinations.map((destination, index) => <TabSlot key={destination.href} name={destination.glyph} home={index === 2}
      label={destination.label} selected={active === index} colors={colors} filled={appearance.icons === 'filled'}
      onPress={() => insideTabs ? router.navigate(destination.href) : router.dismissTo(destination.href)} />)}
  </View>
  </View>;
}
