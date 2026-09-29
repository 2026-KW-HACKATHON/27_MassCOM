import { Link } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion, stampTilt } from '@/motion/timing';
import { useMotionEnabled } from '@/motion/use-motion';
import { stampColumnCount, type PassportStamp } from '@/screens/collection/collection-stamps';
import { uiMetrics } from '@/theme/ui-metrics';
import { worldForScheme } from '@/theme/world';

import { useUiStyles } from './use-ui-styles';

const PAGE_PADDING = 14;
const SLOT_GAP = 10;

/** Cream passport page: a round ink stamp per visited merchant, a dashed circle for the rest. Each slot opens the merchant. */
export function PassportStampPage({ stamps }: { stamps: readonly PassportStamp[] }) {
  const styles = useUiStyles();
  const { width, fontScale } = useWindowDimensions();
  const columns = stampColumnCount(width, fontScale);
  const slotWidth = (width - uiMetrics.pageInset * 2 - PAGE_PADDING * 2 - SLOT_GAP * (columns - 1)) / columns;

  return (
    <View style={styles.stampPage}>
      {stamps.map((stamp) => (
        <StampSlot key={stamp.merchantId} stamp={stamp} width={slotWidth} />
      ))}
    </View>
  );
}

function StampSlot({ stamp, width }: { stamp: PassportStamp; width: number }) {
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

  // Computed on the JS thread: the worklet below runs on the UI runtime, where stampTilt does not exist.
  const tilt = stampTilt(stamp.merchantId);
  const animated = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt}deg` }, { scale: scale.get() }],
  }));

  return (
    <Link href={{ pathname: '/merchants/[merchantId]', params: { merchantId: stamp.merchantId } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={stamp.visited ? `${stamp.name} 도장 받음` : `${stamp.name} 도장 아직 없음`}
        accessibilityHint={stamp.detail}
        style={StyleSheet.flatten([styles.stampSlot, { width }])}
      >
        {stamp.visited ? (
          <Animated.View accessible={false} style={[styles.stampRing, { backgroundColor: world.paper }, animated]}>
            <View style={styles.stampRingInner}>
              <Text maxFontSizeMultiplier={1.2} style={styles.stampMark}>{Array.from(stamp.name).slice(0, 2).join('')}</Text>
            </View>
          </Animated.View>
        ) : (
          <View accessible={false} style={styles.stampRingEmpty}>
            <Text style={styles.stampMystery}>?</Text>
          </View>
        )}
        <Text numberOfLines={2} style={styles.stampName}>{stamp.name}</Text>
        <Text style={styles.stampStatus}>{stamp.statusText}</Text>
        <Text style={styles.stampStatus}>{stamp.goalText}</Text>
      </Pressable>
    </Link>
  );
}
