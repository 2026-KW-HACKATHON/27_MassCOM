import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { mascotArt, type MascotPose } from './mascot-art';
import { mascotAccessibility } from './mascot-a11y';

type Props = {
  pose: MascotPose;
  size: number;
  breathe?: boolean;
  accessibilityLabel?: string;
  /** Wiggles when tapped. Only for a hero that stands on its own; a mascot inside a card stays a plain image. */
  interactive?: boolean;
};

export function Mascot({ pose, size, breathe = true, accessibilityLabel, interactive = false }: Props) {
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  useEffect(() => {
    if (!enabled || !breathe) { scale.set(1); return; }
    scale.set(withRepeat(withTiming(1.03, { duration: motion.breatheMs / 2, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [enabled, breathe, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }] }));
  const wiggle = () => {
    if (!enabled) return;
    rotate.set(withSequence(withTiming(-6, { duration: 90 }), withTiming(6, { duration: 120 }), withTiming(0, { duration: 90 })));
  };
  const a11y = mascotAccessibility(accessibilityLabel);
  const picture = { source: mascotArt[pose], style: [{ width: size, height: size }, animated], resizeMode: 'contain' as const };
  // The accessibility props go on the outermost element so a wrapping Pressable and its picture read as one item.
  if (!interactive) return <Animated.Image {...picture} {...a11y} />;
  return <Pressable onPress={wiggle} {...a11y}><Animated.Image {...picture} /></Pressable>;
}
