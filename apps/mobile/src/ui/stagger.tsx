import type { ReactNode } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { staggerDelay, motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';

export function Stagger({ index, children }: { index: number; children: ReactNode }) {
  const enabled = useMotionEnabled();
  const entering = enabled
    ? FadeInDown.delay(staggerDelay(index)).springify().damping(motion.spring.damping).withInitialValues({ translateY: motion.enterOffset })
    : undefined;
  return <Animated.View entering={entering}>{children}</Animated.View>;
}
