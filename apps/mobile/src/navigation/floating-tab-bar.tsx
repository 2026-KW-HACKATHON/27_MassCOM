import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lightHaptic } from '@/gamification/native-effects';
import { motion } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';

import { TabGlyph } from './tab-glyph';

type GlyphName = ComponentProps<typeof TabGlyph>['name'];
type Route = BottomTabBarProps['state']['routes'][number];

const glyphByRoute: Record<string, GlyphName> = { index: 'explore', claim: 'claim', collection: 'collection' };
// The raised claim button rises this far above the bar; the wrapper is that much taller so every tap lands inside it.
const LIFT = 22;
const GAP = 16;
const CLAIM_BUTTON = 64;

function barHeightFor(fontScale: number): number {
  return fontScale >= 1.5 ? 76 : 64;
}

/** Space a scrolling screen must leave at its bottom so nothing hides behind the floating bar. */
export function useTabBarClearance(): number {
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return barHeightFor(fontScale) + LIFT + GAP + insets.bottom + 16;
}

function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

/** Floating three-slot bar: 탐색 · (raised 방문 인증 stamp) · 도감. Routes hidden with `href: null` get no slot. */
export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const world = worldForScheme(useColorScheme());
  const { fontScale } = useWindowDimensions();
  const keyboardShown = useKeyboardShown();
  const height = barHeightFor(fontScale);

  const visible = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options));
  const focusedKey = state.routes[state.index]?.key;
  // A screen reached through a hidden route (내 정보) reads as its own page, so the bar steps aside.
  if (keyboardShown || !visible.some((route) => route.key === focusedKey)) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrapper, { height: height + LIFT, bottom: GAP + insets.bottom }]}>
      <View
        pointerEvents="none"
        style={[
          styles.bar,
          {
            height, backgroundColor: world.tabBar, borderRadius: world.radius.tabBar,
            shadowColor: world.cardShadow,
          },
        ]}
      />
      <View pointerEvents="box-none" style={styles.row}>
        {visible.map((route) => {
          const options = descriptors[route.key]!.options;
          const selected = route.key === focusedKey;
          const label = options.title ?? route.name;
          const onPress = () => {
            void lightHaptic();
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return route.name === 'claim'
            ? <ClaimSlot key={route.key} route={route} label={label} accessibilityLabel={options.tabBarAccessibilityLabel} selected={selected} onPress={onPress} />
            : <TabSlot key={route.key} route={route} label={label} accessibilityLabel={options.tabBarAccessibilityLabel} selected={selected} onPress={onPress} />;
        })}
      </View>
    </View>
  );
}

function isHidden(options: { tabBarItemStyle?: StyleProp<ViewStyle> } | undefined): boolean {
  return StyleSheet.flatten(options?.tabBarItemStyle)?.display === 'none';
}

type SlotProps = { route: Route; label: string; accessibilityLabel?: string; selected: boolean; onPress: () => void };

function TabSlot({ route, label, accessibilityLabel, selected, onPress }: SlotProps) {
  const world = worldForScheme(useColorScheme());
  const enabled = useMotionEnabled();
  const lift = useSharedValue(0);
  useEffect(() => {
    if (!enabled || !selected) return;
    lift.set(withSequence(withTiming(-4, { duration: 90 }), withSpring(0, motion.spring)));
  }, [enabled, selected, lift]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  const color = selected ? world.tabActive : world.tabInactive;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.slot, { marginTop: LIFT }]}
    >
      <Animated.View style={[styles.slotIcon, animated]}>
        <TabGlyph name={glyphByRoute[route.name] ?? 'explore'} color={color} size={24} />
      </Animated.View>
      <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ClaimSlot({ label, accessibilityLabel, selected, onPress }: SlotProps) {
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <View pointerEvents="box-none" style={styles.claimSlot}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        onPressIn={() => { if (enabled) scale.set(withTiming(0.9, { duration: 70 })); }}
        onPressOut={() => { if (enabled) scale.set(withSpring(1, motion.spring)); }}
        onPress={onPress}
        style={styles.claimPressable}
      >
        <Animated.View
          style={[
            styles.claimButton,
            { backgroundColor: palette.primary, borderColor: world.tabBar, shadowColor: world.cardShadow },
            animated,
          ]}
        >
          <TabGlyph name="claim" color={palette.onPrimary} size={30} />
        </Animated.View>
        <Text
          maxFontSizeMultiplier={1.25}
          numberOfLines={1}
          style={[styles.label, { color: selected ? world.tabActive : world.tabInactive }]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, paddingHorizontal: GAP },
  bar: {
    position: 'absolute', left: GAP, right: GAP, bottom: 0,
    shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  row: { flex: 1, flexDirection: 'row' },
  slot: { flex: 1, minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  slotIcon: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  claimSlot: { flex: 1, alignItems: 'center' },
  claimPressable: { alignItems: 'center', gap: 2, minWidth: uiMetrics.minTouch },
  claimButton: {
    width: CLAIM_BUTTON, height: CLAIM_BUTTON, borderRadius: CLAIM_BUTTON / 2, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
});
