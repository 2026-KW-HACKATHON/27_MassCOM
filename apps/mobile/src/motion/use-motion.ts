import { useReducedMotion } from 'react-native-reanimated';

/** False when the person asked the OS to reduce motion; every effect then jumps to its end state. */
export function useMotionEnabled(): boolean {
  const reduced = useReducedMotion();
  return !reduced;
}
