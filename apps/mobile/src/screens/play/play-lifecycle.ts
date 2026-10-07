export function shouldRenderGameFrame(phase: string, focused: boolean, foreground: boolean, paused = false): boolean {
  return phase === 'playing' && focused && foreground && !paused;
}

/** Both timestamps belong to the issued run; hiding the view cannot extend its expiry. */
export function initialRunElapsed(durationMs: number, startedAt: string, expiresAt: string, wallNow: number): number {
  const started = Date.parse(startedAt);
  const expires = Date.parse(expiresAt);
  const age = Number.isFinite(started) ? wallNow - started : 0;
  const untilExpiry = Number.isFinite(expires) ? durationMs - (expires - wallNow) : 0;
  return Math.max(0, Math.min(durationMs, Math.max(age, untilExpiry)));
}
