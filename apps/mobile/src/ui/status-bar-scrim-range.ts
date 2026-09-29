/** Longest scroll distance the fade takes: header text starts overlapping the status bar icons after about 20dp of scroll. */
const FADE_DISTANCE = 24;

/** Scroll offsets [start, end] where the status-bar scrim goes from clear to solid. No inset (no status bar cover) means no fade. */
export function scrimRange(insetTop: number): readonly [number, number] {
  return [0, Math.max(0, Math.min(insetTop, FADE_DISTANCE))];
}
