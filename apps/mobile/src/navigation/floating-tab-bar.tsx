import { useIsFocused } from 'expo-router';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useContext, useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { lightHaptic } from '@/gamification/native-effects';
import { useMotionEnabled } from '@/motion/use-motion';
import { playUiSound } from '@/sound/ui-sounds';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';
import { TabGlyph } from './tab-glyph';
import { barHeightFor } from './tab-bar-style';
import { tabAppearanceColors } from './tab-appearance';
import { useTabAppearance } from './tab-appearance-provider';

type GlyphName = ComponentProps<typeof TabGlyph>['name'];
const glyphByRoute: Record<string, GlyphName> = {
  shop: 'shop', collection: 'collection', index: 'home', search: 'map', 'play-tab': 'play',
  'shop-again': 'shop', map: 'map', claim: 'claim', friends: 'friends',
};

/** 웹 내비게이션 랜드마크(웹만: 안드로이드 TalkBack에 정지 지점이 하나 더 생기지 않게 한다). */
export const navigationLandmark = Platform.OS === 'web' ? ({ role: 'navigation', 'aria-label': '주요 메뉴' } as const) : {};

/** Five stable destinations; only the active destination gets a filled selection. */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { appearance } = useTabAppearance();
  const scheme = useColorScheme();
  const colors = tabAppearanceColors(appearance, scheme === 'dark');
  const { fontScale } = useWindowDimensions();
  // 이 탭 묶음 위에 하위 화면이 쌓이면 루트 ContextTabBar가 대신 그려진다. 아래에 남은 탭 바까지 그리면 탭 바가 두 벌이 된다.
  const rootFocused = useIsFocused();
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
  if (away || !rootFocused) return null;
  const gap = Math.max(8, insets.bottom);
  return <>
    {/* 떠 있는 바 아래 틈으로 스크롤 콘텐츠가 비치지 않게 화면 배경색으로 덮는다. */}
    <View pointerEvents="none" style={[styles.gapMask, { height: gap, backgroundColor: worldForScheme(scheme).page }]} />
    {/* role은 accessibilityRole보다 앞서므로 탭 목록 역할은 안쪽 View가 그대로 맡고, 이 바깥 View는 화면 전체를 덮되 터치는 막지 않는다. */}
    <View {...navigationLandmark} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <View accessibilityRole="tablist" style={[styles.bar, { bottom: gap, height, backgroundColor: colors.background }]}>
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
    </View>
    </View>
  </>;
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
  gapMask: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', padding: 5, borderRadius: 24,
    boxShadow: '0 3px 18px rgba(20, 56, 45, 0.10)' },
  slot: { flex: 1, minHeight: uiMetrics.minTouch, minWidth: uiMetrics.minTouch, alignItems: 'stretch' },
  selection: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 18 },
});
