import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useContext, useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { uiMetrics } from '@/theme/ui-metrics';
import { TabGlyph } from './tab-glyph';
import { barHeightFor } from './tab-bar-style';
import { tabAppearanceColors } from './tab-appearance';
import { useTabAppearance } from './tab-appearance-provider';

type GlyphName = ComponentProps<typeof TabGlyph>['name'];
const glyphByRoute: Record<string, GlyphName> = {
  shop: 'shop', collection: 'collection', index: 'home', search: 'map', 'play-tab': 'play',
  'shop-again': 'shop', map: 'map', claim: 'claim', friends: 'friends',
};

/** Five stable destinations; only the active destination gets a filled selection. */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { appearance } = useTabAppearance();
  const colors = tabAppearanceColors(appearance, useColorScheme() === 'dark');
  const { fontScale } = useWindowDimensions();
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const reportFootprint = useContext(BottomTabBarHeightCallbackContext);
  const height = barHeightFor(fontScale);
  const visible = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options));
  const focusedKey = state.routes[state.index]?.key;
  const runningGame = Boolean((state.routes[state.index]?.params as { runningGame?: boolean } | undefined)?.runningGame);
  const away = keyboardShown || runningGame || !visible.some((route) => route.key === focusedKey);
  const footprint = away ? 0 : height + 12 + insets.bottom;
  useEffect(() => { reportFootprint?.(footprint); }, [reportFootprint, footprint]);
  if (away) return null;
  return <View accessibilityRole="tablist" style={[styles.bar, {
    bottom: Math.max(8, insets.bottom), height, backgroundColor: colors.background,
  }]}>
    {visible.map((route) => {
      const options = descriptors[route.key]!.options;
      const selected = route.key === focusedKey;
      return <TabSlot key={route.key} home={route.name === 'index'}
        name={glyphByRoute[route.name] ?? 'explore'} label={options.title ?? route.name}
        accessibilityLabel={options.tabBarAccessibilityLabel} selected={selected} filled={appearance.icons === 'filled'}
        colors={colors} onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) {
            void lightHaptic(); playUiSound('navigate'); navigation.navigate(route.name, route.params);
          }
        }} />;
    })}
  </View>;
}

function isHidden(options: { tabBarItemStyle?: StyleProp<ViewStyle> } | undefined): boolean {
  return StyleSheet.flatten(options?.tabBarItemStyle)?.display === 'none';
}
export function TabSlot({ name, label, accessibilityLabel, selected, filled, colors, onPress }: {
  name: GlyphName; label: string; accessibilityLabel?: string; selected: boolean; filled: boolean; home: boolean;
  colors: ReturnType<typeof tabAppearanceColors>; onPress: () => void;
}) {
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return <Pressable accessibilityRole="tab" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }} aria-selected={selected}
    onPress={onPress} onPressIn={() => { if (enabled) scale.set(withTiming(.94, { duration: 90 })); }}
    onPressOut={() => { scale.set(withSpring(1)); }} style={styles.slot}>
    <Animated.View style={[styles.selection, { backgroundColor: selected ? colors.selected : 'transparent' }, animated]}>
      <TabGlyph name={name} size={25} color={selected ? colors.active : colors.inactive} filled={filled} />
      <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ color: selected ? colors.active : colors.inactive,
        fontSize: 12, fontWeight: selected ? '800' : '500' }}>{label}</Text>
    </Animated.View>
  </Pressable>;
}
const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', padding: 5, borderRadius: 24,
    boxShadow: '0 3px 18px rgba(20, 56, 45, 0.10)' },
  slot: { flex: 1, minHeight: uiMetrics.minTouch, minWidth: uiMetrics.minTouch, alignItems: 'stretch' },
  selection: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18 },
});
