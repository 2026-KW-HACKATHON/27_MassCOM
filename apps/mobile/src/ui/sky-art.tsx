import { useEffect } from 'react';
import { Image, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
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
import { compactArtHeight, skyArtHeight } from './sky-art-size';

const CLOUD_WIDTH = 120;
// The picture ends in near-white, not exactly the page colour; this bottom slice is faded into the page colour (world.page) so no band shows.
const SEAM_FRACTION = 0.15;

type Props = {
  /** Shorter banner for back headers: the sky is cropped from the top, the rooftops stay. */
  compact?: boolean;
};

/**
 * The town illustration with its gradient and two drifting clouds, laid over the top of whatever positioned parent holds it.
 * It lives inside the header at the top of the scroll content, so it scrolls away with the screen instead of staying fixed.
 */
export function SkyArt({ compact }: Props) {
  const dark = useColorScheme() === 'dark';
  const world = worldForScheme(dark ? 'dark' : 'light');
  const enabled = useMotionEnabled();
  const { width } = useWindowDimensions();
  const fullHeight = skyArtHeight(width);
  const height = compact ? compactArtHeight(width) : fullHeight;

  return (
    <View pointerEvents="none" style={[styles.art, { height }]}>
      {/* The sky gradient ends in the page colour exactly where the illustration fades out, so no seam shows below it. */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={world.sky[0]} />
            <Stop offset="0.55" stopColor={world.sky[1]} />
            <Stop offset="1" stopColor={world.page} />
          </LinearGradient>
        </Defs>
        <Rect width={width} height={height} fill="url(#sky)" />
      </Svg>
      {/* Bottom-aligned, so a compact banner drops the top of the picture rather than its fade. */}
      <Image source={skyTownHeader} style={{ position: 'absolute', left: 0, bottom: 0, width, height: fullHeight }} resizeMode="cover" />
      {dark ? (
        // Only the picture goes dark; the overlay turns opaque toward the bottom so the white fade never shows as a band.
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={world.sky[0]} stopOpacity={0.55} />
              <Stop offset="1" stopColor={world.page} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width={width} height={height} fill="url(#dusk)" />
        </Svg>
      ) : null}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="seam" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={world.page} stopOpacity={0} />
            <Stop offset="1" stopColor={world.page} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect y={height * (1 - SEAM_FRACTION)} width={width} height={height * SEAM_FRACTION} fill="url(#seam)" />
      </Svg>
      <Cloud enabled={enabled} dark={dark} screenWidth={width} top={height * 0.16} startX={width * 0.12} />
      <Cloud enabled={enabled} dark={dark} screenWidth={width} top={height * 0.36} startX={width * 0.62} />
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
  art: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  cloud: { position: 'absolute', left: 0, width: CLOUD_WIDTH, height: 48 },
});
