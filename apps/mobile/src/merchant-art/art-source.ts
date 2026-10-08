// D-048: a merchant's picture comes from one of three places, in this order: the art its owner picked (served by the API),
// the bundled showcase illustration (demo app only), else nothing, and the caller draws the short glyph stamp.

const ART_PATH = /^\/merchant-art\/[0-9a-f]{64}\.webp$/;

/** Note drawn on a picture the owner chose; the bundled showcase picture keeps its own note. */
export const OWNER_ART_NOTE = '사장님이 적용한 가게 이미지';
export const SHOWCASE_ART_NOTE = '체험용 예시 그림';

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
  return fromServer ? OWNER_ART_NOTE : SHOWCASE_ART_NOTE;
}

/**
 * Note under the picture on a collectible card. The owner's picture only says whose picture it is: it is not an NFT and does
 * not need the "not proof" line, so it never borrows it. The bundled showcase picture keeps its own note and that line.
 */
export function collectibleArtNote(fromServer: boolean): string {
  return fromServer ? OWNER_ART_NOTE : `${SHOWCASE_ART_NOTE} · 실제 NFT 발행 증거 아님`;
}

/** The address of a picture that comes from the API; bundled pictures (module numbers) have none and cannot fail to load. */
export function remoteArtUri(source: unknown): string | undefined {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return undefined;
  const uri: unknown = Reflect.get(source, 'uri');
  return typeof uri === 'string' ? uri : undefined;
}

/**
 * A picture whose address failed to load (a stale catalog can still point at art that was reset and now answers 404) counts as
 * missing, so the caller draws the glyph stamp instead of an empty frame. A different address gets its own chance.
 */
export function usableArtSource<Source>(source: Source | undefined, failedUri: string | null): Source | undefined {
  const uri = remoteArtUri(source);
  return uri !== undefined && uri === failedUri ? undefined : source;
}
