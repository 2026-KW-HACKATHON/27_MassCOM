// sky-town-header.png is 1080×720 and fades to white along its bottom edge, so it is drawn uncropped where it fits.
export const SKY_ART_ASPECT = 720 / 1080;
/** Back headers show the lower part of the picture (rooftops, low clouds) and crop the sky, so they stay compact. */
export const COMPACT_ART_FRACTION = 0.75;

export function skyArtHeight(width: number): number {
  return Math.round(width * SKY_ART_ASPECT);
}

export function compactArtHeight(width: number): number {
  return Math.round(skyArtHeight(width) * COMPACT_ART_FRACTION);
}
