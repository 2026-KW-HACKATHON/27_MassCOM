import { useCallback } from 'react';
import { StyleSheet, useColorScheme, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMotionEnabled } from '../motion/use-motion';
import { withAlpha } from '../theme/contrast';
import { worldForScheme } from '../theme/world';
import { scrimRange } from './status-bar-scrim-range';

/** Scroll offset of a sky screen's scroller. Spread `onScroll` onto the ScrollView / FlatList and draw StatusBarScrim beside it. */
export function useStatusBarScrim() {
  const scrollY = useSharedValue(0);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.set(event.nativeEvent.contentOffset.y);
  }, [scrollY]);
  return { scrollY, onScroll };
}

/**
 * Solid strip over the status bar. The header art and text scroll away, and without this the clock and icons would sit on top of
 * whatever comes next. It fades in over the first ~24dp of scrolling; with reduced motion it just switches on halfway.
 * Place it after the scroller inside the screen's positioned root (SkyBackdrop); it never takes touches.
 */
export function StatusBarScrim({ scrollY }: { scrollY: SharedValue<number> }) {
  const world = worldForScheme(useColorScheme());
  const insets = useSafeAreaInsets();
  const enabled = useMotionEnabled();
  const top = insets.top;
  const [from, to] = scrimRange(top);
  const animated = useAnimatedStyle(() => {
    if (to <= from) return { opacity: 0 };
    const offset = scrollY.get();
    return { opacity: enabled ? interpolate(offset, [from, to], [0, 1], Extrapolation.CLAMP) : offset >= (from + to) / 2 ? 1 : 0 };
  });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      style={[styles.scrim, { height: insets.top, backgroundColor: withAlpha(world.sky[2], world.statusScrimAlpha) }, animated]}
    />
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});
