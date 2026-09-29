import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { createReduceMotionStore } from './reduce-motion';

const liveReduceMotion = createReduceMotionStore({
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  listen: (onChange) => { AccessibilityInfo.addEventListener('reduceMotionChanged', onChange); },
});

/**
 * False when the person asked the OS to reduce motion; every effect then jumps to its end state.
 * Reanimated reads the setting once at startup, so the live OS value is followed as well and toggling it takes effect at once.
 */
export function useMotionEnabled(): boolean {
  const reanimatedReduced = useReducedMotion();
  const liveReduced = useSyncExternalStore(liveReduceMotion.subscribe, liveReduceMotion.get, () => false);
  return !reanimatedReduced && !liveReduced;
}
