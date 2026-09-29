import { TOWN_MAP_ART, type Anchor } from './anchors';

/** Drawn size of a pin and the touch target around it (the target is 48dp, the picture 44dp). */
export const PIN_SIZE = 44;
export const PIN_TOUCH = 48;

// Keeps a revealed pin this far from the status bar and from the sheet.
const REVEAL_MARGIN = PIN_TOUCH / 2 + 8;

export function mapHeightFor(width: number): number {
  return width * (TOWN_MAP_ART.height / TOWN_MAP_ART.width);
}

/** Where a pin's centre sits inside the drawn map. */
export function pinCenter(anchor: Anchor, mapWidth: number): { x: number; y: number } {
  return { x: anchor.x * mapWidth, y: anchor.y * mapHeightFor(mapWidth) };
}

/**
 * The scroll offset that keeps a selected pin visible above the bottom sheet, or null when it already is.
 * `pinY` is the pin's centre inside the scroll content, `coverHeight` how much of the screen's bottom the sheet hides.
 */
export function revealScrollY(view: { pinY: number; scrollY: number; viewportHeight: number; coverHeight: number; topInset: number }): number | null {
  const bandTop = view.topInset + REVEAL_MARGIN;
  const bandBottom = view.viewportHeight - view.coverHeight - REVEAL_MARGIN;
  const onScreen = view.pinY - view.scrollY;
  if (onScreen >= bandTop && onScreen <= bandBottom) return null;
  // Aim for the middle of the free band; when the sheet leaves no band at all, the top of what is left.
  const aim = bandBottom > bandTop ? (bandTop + bandBottom) / 2 : bandTop;
  return Math.max(0, view.pinY - aim);
}
