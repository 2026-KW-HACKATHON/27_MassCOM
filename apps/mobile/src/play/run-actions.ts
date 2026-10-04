import type { GameAction } from '../../../api/src/play-rules';

/** Keep timestamps monotonic even for taps delivered in the same millisecond. */
export function appendAction(actions: readonly GameAction[], choice: number, elapsedMs: number, durationMs: number): GameAction[] | undefined {
  if (!Number.isInteger(choice) || choice < 0 || !Number.isFinite(elapsedMs) || elapsedMs > durationMs) return undefined;
  const at = Math.max(Math.floor(elapsedMs), (actions.at(-1)?.at ?? -1) + 1);
  if (at > durationMs) return undefined;
  return [...actions, { at, choice }];
}

export function finalizeDeliveryActions(actions: readonly GameAction[], lane: number, elapsedMs: number, durationMs: number): readonly GameAction[] {
  if (actions.length >= 20 || !Number.isInteger(lane) || lane < 0 || lane > 2) return actions;
  return appendAction(actions, lane, Math.min(elapsedMs, durationMs), durationMs) ?? actions;
}

export function memoryRevealDelay(isMatch: boolean, motionEnabled: boolean): number {
  return isMatch && !motionEnabled ? 0 : isMatch ? 440 : 750;
}
