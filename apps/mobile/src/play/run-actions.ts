import type { GameAction, GameKind } from '../../../api/src/play-rules';

// Kept local for input gating; the contract test checks the server's values.
export const mobileMinimumActionGapMs: Readonly<Record<GameKind, number>> = { stack: 150, memory: 80, delivery: 150, orders: 100 };

/** Ignore early input: never invent elapsed time or mutate the accepted log. */
export function appendAction(actions: readonly GameAction[], choice: number, elapsedMs: number, durationMs: number, kind: GameKind,
  previousElapsedMs = actions.at(-1)?.at): GameAction[] | undefined {
  if (!Number.isInteger(choice) || choice < 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > durationMs) return undefined;
  // The screen preserves precise arrival time separately from serialized integer timestamps.
  if (previousElapsedMs !== undefined && elapsedMs - previousElapsedMs < mobileMinimumActionGapMs[kind]) return undefined;
  const at = Math.floor(elapsedMs);
  const previous = actions.at(-1);
  if (previous && at - previous.at < mobileMinimumActionGapMs[kind]) return undefined;
  return [...actions, { at, choice }];
}

export function finalizeDeliveryActions(actions: readonly GameAction[], lane: number, elapsedMs: number, durationMs: number,
  _previousElapsedMs = actions.at(-1)?.at): readonly GameAction[] {
  if (actions.length >= 20 || !Number.isInteger(lane) || lane < 0 || lane > 2) return actions;
  const at = Math.floor(Math.min(elapsedMs, durationMs));
  const previous = actions.at(-1);
  // A final sample observes the accepted lane; it must not smuggle in a move.
  if (!Number.isSafeInteger(at) || at < 0 || (previous && (lane !== previous.choice || at <= previous.at))) return actions;
  return [...actions, { at, choice: lane }];
}

export function memoryRevealDelay(isMatch: boolean, motionEnabled: boolean): number {
  return isMatch && !motionEnabled ? 0 : isMatch ? 440 : 750;
}

export function shouldWaitForDeliverySample(actions: readonly GameAction[], elapsedMs: number, durationMs: number, finalTickAt: number): boolean {
  // The interval will try again using actual elapsed time; never submit a pre-final-tick log as an auto finish.
  return elapsedMs >= finalTickAt && elapsedMs < durationMs && (actions.at(-1)?.at ?? 0) < finalTickAt;
}
