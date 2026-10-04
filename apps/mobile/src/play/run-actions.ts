import type { GameAction } from '../../../api/src/play-rules';

/** Keep timestamps monotonic even for taps delivered in the same millisecond. */
export function appendAction(actions: readonly GameAction[], choice: number, elapsedMs: number, durationMs: number): GameAction[] | undefined {
  if (!Number.isInteger(choice) || choice < 0 || !Number.isFinite(elapsedMs) || elapsedMs > durationMs) return undefined;
  const at = Math.max(Math.floor(elapsedMs), (actions.at(-1)?.at ?? -1) + 1);
  if (at > durationMs) return undefined;
  return [...actions, { at, choice }];
}
