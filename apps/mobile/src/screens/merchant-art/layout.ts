import { uiMetrics } from '../../theme/ui-metrics';

/** FloatingCard's own padding; the picture grid sits inside it. */
export const CARD_PADDING = 18;
export const TILE_GAP = 12;
/** Side of the picture on the "current art" card. */
export const CURRENT_ART_SIZE = 144;

const innerWidth = (viewportWidth: number) => viewportWidth - uiMetrics.pageInset * 2 - CARD_PADDING * 2;

/** Side of one draft in the 2x2 grid: two of them and the gap fill the card's inner width exactly, so the grid never wraps to one column. */
export function draftTileSize(viewportWidth: number): number {
  return Math.max(1, Math.floor((innerWidth(viewportWidth) - TILE_GAP) / 2));
}

/** Side of the large final picture: the card's inner width. */
export function finalArtSize(viewportWidth: number): number {
  return Math.max(1, Math.floor(innerWidth(viewportWidth)));
}
