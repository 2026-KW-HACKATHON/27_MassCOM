import { useEffect, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { motion, STAGGER_LIMIT, staggerDelay } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';

/**
 * Fades and floats its children in, later rows a little after earlier ones.
 * Driven by a shared value rather than a layout `entering` animation: those could leave a whole screen hidden at opacity 0,
 * so on top of the spring a timer forces the end state shortly after the entrance should have finished.
 */
export function Stagger({ index, children }: { index: number; children: ReactNode }) {
  const enabled = useMotionEnabled();
  const animate = enabled && index < STAGGER_LIMIT;
  const progress = useSharedValue(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) { progress.set(1); return; }
    const delay = staggerDelay(index);
    progress.set(withDelay(delay, withSpring(1, motion.spring)));
    const failsafe = setTimeout(() => progress.set(1), delay + motion.enterFailsafeMs);
    return () => clearTimeout(failsafe);
  }, [animate, index, progress]);

  const offset = motion.enterOffset;
  const animated = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.get()),
    transform: [{ translateY: (1 - progress.get()) * offset }],
  }));

  if (index >= STAGGER_LIMIT) return <>{children}</>;
  return <Animated.View style={animated}>{children}</Animated.View>;
}
