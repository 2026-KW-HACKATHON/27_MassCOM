/** System text size (font scale) from which a screen trades decoration for room: 150% and up. */
export const LARGE_TEXT_SCALE = 1.5;

export function isLargeText(fontScale: number): boolean {
  return fontScale >= LARGE_TEXT_SCALE;
}

/** Hero mascots shrink to at most 72dp at large text so the first screen is not all header. */
export function heroMascotSize(fontScale: number, size: number): number {
  return isLargeText(fontScale) ? Math.min(size, 72) : size;
}

/** 브라우저 확대(Ctrl +)는 fontScale이 아니라 창 너비를 줄인다. 이 너비(dp) 미만이면 좁은 화면으로 본다. */
export const NARROW_WIDTH = 300;

export function isNarrow(width: number): boolean {
  return width > 0 && width < NARROW_WIDTH;
}
