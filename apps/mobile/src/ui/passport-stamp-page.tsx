import { Link } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useArtFallback } from '@/merchant-art/use-art-fallback';
import { motion, stampTilt } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { stampColumnCount, type PassportStamp } from '@/screens/collection/collection-stamps';
import { merchantArtSource } from '@/screens/collection/merchant-art';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';

import { useUiStyles } from './use-ui-styles';

const PAGE_PADDING = 14;
const SLOT_GAP = 10;

/** Cream passport page: a round ink stamp per visited merchant, a dashed circle for the rest. Each slot opens the merchant. */
export function PassportStampPage({ stamps, apiUrl }: { stamps: readonly PassportStamp[]; apiUrl: string }) {
  const styles = useUiStyles();
  const { width, fontScale } = useWindowDimensions();
  const columns = stampColumnCount(width, fontScale);
  const slotWidth = (width - uiMetrics.pageInset * 2 - PAGE_PADDING * 2 - SLOT_GAP * (columns - 1)) / columns;

  return (
    <View style={styles.stampPage}>
      {stamps.map((stamp) => (
        <StampSlot key={stamp.merchantId} stamp={stamp} width={slotWidth} apiUrl={apiUrl} />
      ))}
    </View>
  );
}

function StampSlot({ stamp, width, apiUrl }: { stamp: PassportStamp; width: number; apiUrl: string }) {
  const styles = useUiStyles();
  const world = worldForScheme(useColorScheme());
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const wasVisited = useRef(stamp.visited);

  // A stamp that appears while the page is open (a visit was just confirmed) lands with a thud.
  useEffect(() => {
    if (stamp.visited && !wasVisited.current && enabled) {
      scale.set(1.4);
      scale.set(withSpring(1, motion.spring));
    }
    wasVisited.current = stamp.visited;
  }, [stamp.visited, enabled, scale]);

  // The owner's AI picture, else the showcase illustration (only in the demo app), else the short glyph. A picture that fails to
  // load (a stale catalog pointing at art that was reset) falls back to the glyph too.
  const { source: art, onError } = useArtFallback(merchantArtSource({ id: stamp.merchantId, artUrl: stamp.artUrl }, apiUrl));
  // Computed on the JS thread: the worklet below runs on the UI runtime, where stampTilt does not exist.
  const tilt = stampTilt(stamp.merchantId);
  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt}deg` }, { scale: scale.get() }],
  }));

  return (
    <Link href={{ pathname: '/merchants/[merchantId]', params: { merchantId: stamp.merchantId, from: 'collection' } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stamp.label}
        accessibilityHint="음식점 상세 보기"
        style={StyleSheet.flatten([styles.stampSlot, { width }])}
      >
        {stamp.visited ? (
          <Animated.View accessible={false} style={[styles.stampRing, { backgroundColor: world.paper }, animated]}>
            <View style={styles.stampRingInner}>
              {art ? (
                <Image source={art} onError={onError} accessible={false} accessibilityIgnoresInvertColors resizeMode="cover" style={styles.stampArt} />
              ) : (
                <Text maxFontSizeMultiplier={1.2} style={styles.stampMark}>{stamp.glyph}</Text>
              )}
            </View>
          </Animated.View>
        ) : (
          <View accessible={false} style={styles.stampRingEmpty}>
            <Text style={styles.stampMystery}>?</Text>
          </View>
        )}
        <Text textBreakStrategy="simple" style={styles.stampName}>{stamp.name}</Text>
        <Text style={styles.stampStatus}>{stamp.statusText}</Text>
        <Text style={styles.stampStatus}>{stamp.goalText}</Text>
      </Pressable>
    </Link>
  );
}
