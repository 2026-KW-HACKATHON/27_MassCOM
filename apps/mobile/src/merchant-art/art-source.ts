// D-048: a merchant's picture comes from one of three places, in this order: the art its owner picked (served by the API),
// the bundled showcase illustration (demo app only), else nothing, and the caller draws the short glyph stamp.

const ART_PATH = /^\/merchant-art\/[0-9a-f]{64}\.webp$/;

/** Note drawn on a picture the owner chose; the bundled showcase picture keeps its own note. */
export const AI_ART_NOTE = '사장님이 고른 AI 그림';
export const SHOWCASE_ART_NOTE = '가상 점포 시연 그림';

/** The API's public art path (`/merchant-art/<sha256>.webp`); anything else is not ours to load, so it becomes null. */
export function parseMerchantArtPath(value: unknown): string | null {
  return typeof value === 'string' && ART_PATH.test(value) ? value : null;
}

/** Absolute address of an art path on the API, or undefined when either half is missing or not a valid art path. */
export function merchantArtUri(apiUrl: string | undefined, artPath: string | null | undefined): string | undefined {
  const path = parseMerchantArtPath(artPath);
  const origin = apiUrl?.trim().replace(/\/+$/, '');
  return path && origin ? `${origin}${path}` : undefined;
}

export type ChosenArt<Bundled> =
  | { fromServer: true; source: { uri: string } }
  | { fromServer: false; source: Bundled };

/** Server art first, then the bundled picture, else undefined. A path that is not a valid art path is ignored like a missing one. */
export function chooseMerchantArt<Bundled>(input: {
  artUrl?: string | null;
  apiUrl?: string;
  bundled: Bundled | undefined;
}): ChosenArt<Bundled> | undefined {
  const uri = merchantArtUri(input.apiUrl, input.artUrl);
  if (uri) return { fromServer: true, source: { uri } };
  return input.bundled === undefined ? undefined : { fromServer: false, source: input.bundled };
}

export function merchantArtNote(fromServer: boolean): string {
  return fromServer ? AI_ART_NOTE : SHOWCASE_ART_NOTE;
}
