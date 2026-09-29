export const motion = {
  pressScale: 0.96,
  spring: { damping: 14, stiffness: 220 },
  breatheMs: 3000,
  cloudMs: 40000,
  enterOffset: 12,
  /** An entrance must be finished this long after it should have ended, even if the animation never ran. */
  enterFailsafeMs: 1200,
} as const;

/** Only the first screenful floats in one by one; later rows (windowed lists) appear at once. */
export const STAGGER_LIMIT = 8;

const STEP_MS = 50;
const MAX_STEPS = STAGGER_LIMIT - 1;

/** Entry delay for the index-th list item; long lists never wait more than 350ms, and a non-finite index waits not at all. */
export function staggerDelay(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.floor(index)), MAX_STEPS) * STEP_MS;
}

/** Deterministic ink-stamp rotation in degrees for a merchant, −12…12. */
export function stampTilt(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 25) - 12;
}
