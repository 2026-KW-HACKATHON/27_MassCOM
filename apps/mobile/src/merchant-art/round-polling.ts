import { isRoundInProgress } from './art-state';
import type { ArtRound } from './owner-art-api';

/** How often the app asks the server about a round it is drawing (D-048: every 3 seconds). */
export const ROUND_POLL_INTERVAL_MS = 3000;

export type PollTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

type Options = {
  /** Reads the round now. */
  poll: () => Promise<ArtRound>;
  onRound: (round: ArtRound) => void;
  onError: (error: unknown) => void;
  /** An answer asking again will not change (no access, no such round): polling stops instead of retrying. */
  isPermanentError?: (error: unknown) => boolean;
  intervalMs?: number;
  timers?: PollTimers;
};

const liveTimers: PollTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Asks for a round every few seconds while the server is still drawing it. One request at a time: the next one is scheduled only
 * after the last answered. `stop()` (unmount, blur) cancels the timer and makes an answer that is still on its way count for
 * nothing, so a slow reply can never touch a screen the owner has left. Stops by itself once the round is no longer in progress.
 */
export function createRoundPoller(options: Options) {
  const intervalMs = options.intervalMs ?? ROUND_POLL_INTERVAL_MS;
  const timers = options.timers ?? liveTimers;
  let running = false;
  let generation = 0;
  let timer: unknown;

  function schedule(current: number) {
    timer = timers.setTimeout(() => { void tick(current); }, intervalMs);
  }

  async function tick(current: number) {
    timer = undefined;
    try {
      const round = await options.poll();
      if (current !== generation) return;
      options.onRound(round);
      if (isRoundInProgress(round.status)) schedule(current);
      else stop();
    } catch (error) {
      if (current !== generation) return;
      options.onError(error);
      if (options.isPermanentError?.(error)) stop();
      else schedule(current);
    }
  }

  function stop() {
    running = false;
    generation += 1;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  }

  return {
    start() {
      if (running) return;
      running = true;
      generation += 1;
      schedule(generation);
    },
    stop,
    isRunning: () => running,
  };
}
