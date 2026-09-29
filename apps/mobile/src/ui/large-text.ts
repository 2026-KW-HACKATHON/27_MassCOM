/** System text size (font scale) from which a screen trades decoration for room: 150% and up. */
export const LARGE_TEXT_SCALE = 1.5;

export function isLargeText(fontScale: number): boolean {
  return fontScale >= LARGE_TEXT_SCALE;
}

/** Hero mascots shrink to at most 72dp at large text so the first screen is not all header. */
export function heroMascotSize(fontScale: number, size: number): number {
  return isLargeText(fontScale) ? Math.min(size, 72) : size;
}
