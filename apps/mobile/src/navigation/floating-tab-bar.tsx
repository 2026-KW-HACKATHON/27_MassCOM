import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useContext, useEffect, useState, type ComponentProps } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { lightHaptic } from '@/gamification/native-effects';
import { motion } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { colorsForScheme } from '@/theme/palette';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';

import { TabGlyph } from './tab-glyph';
import { barHeightFor, tabIndicator } from './tab-bar-style';

type GlyphName = ComponentProps<typeof TabGlyph>['name'];
type Route = BottomTabBarProps['state']['routes'][number];

const glyphByRoute: Record<string, GlyphName> = { index: 'explore', claim: 'claim', collection: 'collection' };
// The raised claim button rises this far above the bar; the wrapper is that much taller so every tap lands inside it.
const LIFT = 22;
const GAP = 16;
const CLAIM_BUTTON = 64;
// The mask fades in this far above the bar's top edge, so it never reads as a hard band behind the raised button.
const MASK_FADE = 18;

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
  const reportFootprint = useContext(BottomTabBarHeightCallbackContext);
  const height = barHeightFor(fontScale);

  const visible = state.routes.filter((route) => !isHidden(descriptors[route.key]?.options));
  const focusedKey = state.routes[state.index]?.key;
  // A screen reached through a hidden route (내 정보) reads as its own page, so the bar steps aside.
  const away = keyboardShown || !visible.some((route) => route.key === focusedKey);
  const footprint = away ? 0 : height + LIFT + GAP + insets.bottom;
  useEffect(() => { reportFootprint?.(footprint); }, [reportFootprint, footprint]);
  if (away) return null;

  const maskHeight = insets.bottom + GAP + height + MASK_FADE;
  return (
    <>
      {/* Content scrolls under the 16dp gap around the bar; the page colour fades in over it. It never takes touches. */}
      <View pointerEvents="none" style={[styles.mask, { height: maskHeight }]}>
        <Svg width="100%" height={maskHeight}>
          <Defs>
            <LinearGradient id="barMask" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={world.page} stopOpacity={0} />
              <Stop offset={MASK_FADE / maskHeight} stopColor={world.page} stopOpacity={0.9} />
              <Stop offset="1" stopColor={world.page} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={maskHeight} fill="url(#barMask)" />
        </Svg>
      </View>
      <View pointerEvents="box-none" style={[styles.wrapper, { height: height + LIFT, bottom: GAP + insets.bottom }]}>
        {/* The surface takes touches itself: the empty band beside the raised button used to pass them to the list below. */}
        <View
          style={[
            styles.bar,
            {
              height, backgroundColor: world.tabBar, borderRadius: world.radius.tabBar,
              shadowColor: world.cardShadow,
            },
          ]}
        />
        <View accessibilityRole="tablist" pointerEvents="box-none" style={styles.row}>
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
    </>
  );
}

function isHidden(options: { tabBarItemStyle?: StyleProp<ViewStyle> } | undefined): boolean {
  return StyleSheet.flatten(options?.tabBarItemStyle)?.display === 'none';
}

type SlotProps = { route: Route; label: string; accessibilityLabel?: string; selected: boolean; onPress: () => void };

function TabSlot({ route, label, accessibilityLabel, selected, onPress }: SlotProps) {
  const scheme = useColorScheme();
  const world = worldForScheme(scheme);
  const indicator = tabIndicator(selected, colorsForScheme(scheme), world);
  const enabled = useMotionEnabled();
  const lift = useSharedValue(0);
  useEffect(() => {
    if (!enabled || !selected) return;
    lift.set(withSequence(withTiming(-4, { duration: 90 }), withSpring(0, motion.spring)));
  }, [enabled, selected, lift]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.slot, { marginTop: LIFT }]}
    >
      <Animated.View style={[indicator.pill, animated]}>
        <TabGlyph name={glyphByRoute[route.name] ?? 'explore'} color={indicator.iconColor} size={24} />
      </Animated.View>
      <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.label, indicator.label]}>{label}</Text>
    </Pressable>
  );
}

function ClaimSlot({ label, accessibilityLabel, selected, onPress }: SlotProps) {
  const palette = colorsForScheme(useColorScheme());
  const world = worldForScheme(useColorScheme());
  const indicator = tabIndicator(selected, palette, world);
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
          {indicator.claimRing ? <View pointerEvents="none" style={indicator.claimRing} /> : null}
          <TabGlyph name="claim" color={palette.onPrimary} size={30} />
        </Animated.View>
        <Text
          maxFontSizeMultiplier={1.5}
          numberOfLines={1}
          style={[styles.label, indicator.label]}
        >
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  wrapper: { position: 'absolute', left: 0, right: 0, paddingHorizontal: GAP },
  bar: {
    position: 'absolute', left: GAP, right: GAP, bottom: 0,
    shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  row: { flex: 1, flexDirection: 'row' },
  slot: { flex: 1, minHeight: uiMetrics.minTouch, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 4 },
  label: { fontSize: 12, textAlign: 'center' },
  claimSlot: { flex: 1, alignItems: 'center' },
  claimPressable: { alignItems: 'center', gap: 2, minWidth: uiMetrics.minTouch },
  claimButton: {
    width: CLAIM_BUTTON, height: CLAIM_BUTTON, borderRadius: CLAIM_BUTTON / 2, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
});
