export function useMotionEnabled(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
