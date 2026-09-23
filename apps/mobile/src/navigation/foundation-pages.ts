export const PAGE_COUNT = 5;
export const INITIAL_PAGE = 2;

export function pageAtOffset(offset: number, width: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(width) || width <= 0) return INITIAL_PAGE;
  return Math.min(PAGE_COUNT - 1, Math.max(0, Math.round(offset / width)));
}
