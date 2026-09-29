import { useEffect, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';

import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { worldForScheme } from '../theme/world';
import { skyTownHeader } from './mascot-art';

// sky-town-header.png is 1080×720 and fades to white along its bottom edge, so it is drawn uncropped.
// Explicit pixel sizes: percentage width + aspectRatio rendered at intrinsic size on a real device (see merchant-list).
const HEADER_ASPECT = 720 / 1080;
const CLOUD_WIDTH = 120;

type Props = {
  /** Wrap the children in a scroll view (screens that bring their own list or scroller leave this off). */
  scroll?: boolean;
  children?: ReactNode;
};

/** Full-screen sky: gradient, the town illustration on top, two drifting clouds. Children draw above it. */
export function SkyBackdrop({ scroll, children }: Props) {
  const dark = useColorScheme() === 'dark';
  const world = worldForScheme(dark ? 'dark' : 'light');
  const enabled = useMotionEnabled();
  const { width } = useWindowDimensions();
  const headerHeight = Math.round(width * HEADER_ASPECT);

  return (
    <View style={[styles.root, { backgroundColor: world.sky[2] }]}>
      {/* The sky gradient ends in sky[2] exactly where the illustration fades out, so no seam shows below it. */}
      <View pointerEvents="none" style={[styles.header, { height: headerHeight }]}>
        <Svg width={width} height={headerHeight} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={world.sky[0]} />
              <Stop offset="0.55" stopColor={world.sky[1]} />
              <Stop offset="1" stopColor={world.sky[2]} />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={headerHeight} fill="url(#sky)" />
        </Svg>
        <Image source={skyTownHeader} style={{ width, height: headerHeight }} resizeMode="cover" />
        {dark ? (
          // Only the picture goes dark; the overlay turns opaque toward the bottom so the white fade never shows as a band.
          <Svg width={width} height={headerHeight} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={world.sky[0]} stopOpacity={0.55} />
                <Stop offset="1" stopColor={world.sky[2]} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect width={width} height={headerHeight} fill="url(#dusk)" />
          </Svg>
        ) : null}
        <Cloud enabled={enabled} dark={dark} screenWidth={width} top={headerHeight * 0.16} startX={width * 0.12} />
        <Cloud enabled={enabled} dark={dark} screenWidth={width} top={headerHeight * 0.36} startX={width * 0.62} />
      </View>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : children}
    </View>
  );
}

type CloudProps = { enabled: boolean; dark: boolean; screenWidth: number; top: number; startX: number };

function Cloud({ enabled, dark, screenWidth, top, startX }: CloudProps) {
  const x = useSharedValue(startX);
  useEffect(() => {
    if (!enabled) { x.set(startX); return; }
    // Finish the current pass from where the cloud rests, then loop off-screen to off-screen.
    const firstPassMs = ((screenWidth - startX) / (screenWidth + CLOUD_WIDTH)) * motion.cloudMs;
    x.set(withSequence(
      withTiming(screenWidth, { duration: firstPassMs, easing: Easing.linear }),
      withRepeat(
        withSequence(
          withTiming(-CLOUD_WIDTH, { duration: 0 }),
          withTiming(screenWidth, { duration: motion.cloudMs, easing: Easing.linear }),
        ),
        -1,
        false,
      ),
    ));
  }, [enabled, screenWidth, startX, x]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View style={[styles.cloud, { top }, animated]}>
      <Svg width={CLOUD_WIDTH} height={48} viewBox="0 0 120 48">
        <Ellipse cx="60" cy="32" rx="52" ry="13" fill="#FFFFFF" fillOpacity={dark ? 0.12 : 0.85} />
        <Ellipse cx="44" cy="24" rx="26" ry="16" fill="#FFFFFF" fillOpacity={dark ? 0.12 : 0.85} />
        <Ellipse cx="78" cy="22" rx="22" ry="14" fill="#FFFFFF" fillOpacity={dark ? 0.12 : 0.85} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  cloud: { position: 'absolute', left: 0, width: CLOUD_WIDTH, height: 48 },
  scrollContent: { paddingBottom: 120 },
});
