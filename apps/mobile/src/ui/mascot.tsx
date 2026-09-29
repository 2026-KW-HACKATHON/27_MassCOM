import { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';
import { mascotArt, type MascotPose } from './mascot-art';

type Props = { pose: MascotPose; size: number; breathe?: boolean; accessibilityLabel?: string };

export function Mascot({ pose, size, breathe = true, accessibilityLabel }: Props) {
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
  return (
    <Pressable
      onPress={wiggle}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Animated.Image source={mascotArt[pose]} style={[{ width: size, height: size }, animated]} resizeMode="contain" />
    </Pressable>
  );
}
