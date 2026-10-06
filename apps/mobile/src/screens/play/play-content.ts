import type { RealGameContext, MerchantPhoto } from '../../../../api/src/real-world-contract';
import type { OwnedArt } from './play-art';

export type PlayObject = { name: string; uri?: string; source: 'menu' | 'sign' | 'merchant' | 'packaging' | 'collectible' | 'practice' };
export type PlayContent = {
  merchantName?: string;
  roadAddress?: string;
  contentVersion?: number;
  tokens: PlayObject[];
  package: PlayObject;
  destination: PlayObject;
};

export class PlayContentLoadError extends Error {
  constructor(readonly code: 'COLLECTION_UNAVAILABLE' | 'GAME_CONTENT_UNAVAILABLE', readonly cause: unknown) {
    super(code);
  }
}

const practice = (index: number): PlayObject => ({ name: `연습 그림 ${index + 1}`, source: 'practice' });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const validMenu = (value: unknown): boolean => record(value) && typeof value.id === 'string' &&
  typeof value.name === 'string' && !!value.name.trim() && (value.photoId === null || typeof value.photoId === 'string');
const validPhoto = (value: unknown): boolean => record(value) && typeof value.id === 'string' &&
  typeof value.url === 'string' && value.source === 'OWNER_PHOTO' &&
  ['STORE', 'MENU', 'ENTRANCE', 'PACKAGING', 'SIGN'].includes(String(value.kind));
const validContext = (value: unknown): value is RealGameContext => record(value) &&
  typeof value.merchantId === 'string' && typeof value.merchantName === 'string' &&
  typeof value.roadAddress === 'string' && Number.isSafeInteger(value.profileVersion) && Number(value.profileVersion) >= 0 &&
  Array.isArray(value.menuItems) && value.menuItems.every(validMenu) &&
  Array.isArray(value.photos) && value.photos.every(validPhoto);

function photo(photos: readonly MerchantPhoto[], kind: MerchantPhoto['kind'], apiUrl: string): string | undefined {
  const found = photos.find((entry) => entry && entry.source === 'OWNER_PHOTO' && entry.kind === kind && typeof entry.url === 'string');
  if (!found) return;
  try {
    const base = new URL(apiUrl);
    const url = new URL(found.url, base);
    return url.origin === base.origin ? url.toString() : undefined;
  } catch { return undefined; }
}

export async function fetchPlayContent(apiUrl: string, merchantIds: readonly string[], signal: AbortSignal, fetcher = fetch): Promise<RealGameContext[]> {
  if (!merchantIds.length) return [];
  const response = await fetcher(`${apiUrl.replace(/\/+$/, '')}/v1/discovery/game-content`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ merchantIds: [...new Set(merchantIds)].slice(0, 20) }), signal,
  });
  if (!response.ok) throw new Error('GAME_CONTENT_UNAVAILABLE');
  const body: unknown = await response.json();
  if (!record(body) || body.schemaVersion !== 1 || typeof body.asOf !== 'string' || !Number.isFinite(Date.parse(body.asOf)) ||
    !Array.isArray(body.contexts) || !body.contexts.every(validContext)) throw new Error('INVALID_GAME_CONTENT');
  return body.contexts;
}

export async function startWithCurrentContent<T>(
  loadOwned: () => Promise<OwnedArt[]>,
  loadContexts: (merchantIds: string[]) => Promise<RealGameContext[]>,
  issueRun: () => Promise<T>,
  apiUrl: string,
  signal: AbortSignal,
): Promise<{ art: OwnedArt[]; content: PlayContent; run: T }> {
  const art = await loadOwned().catch((cause: unknown) => { throw new PlayContentLoadError('COLLECTION_UNAVAILABLE', cause); });
  if (signal.aborted) throw new Error('START_ABORTED');
  const ids = art.map((item) => item.merchantId).filter((id): id is string => !!id);
  const contexts = await loadContexts(ids).catch((cause: unknown) => { throw new PlayContentLoadError('GAME_CONTENT_UNAVAILABLE', cause); });
  if (signal.aborted) throw new Error('START_ABORTED');
  const content = playContent(art, contexts, apiUrl);
  const run = await issueRun();
  return { art, content, run };
}

/** Only currently published server context may label practice artwork as a real item. */
export function playContent(art: readonly OwnedArt[], contexts: readonly RealGameContext[], apiUrl: string): PlayContent {
  const owned = art.find((item) => item.merchantId && contexts.some((context) => context.merchantId === item.merchantId));
  const context = contexts.find((item) => item.merchantId === owned?.merchantId);
  if (!context) return { tokens: Array.from({ length: 6 }, (_, index) => practice(index)), package: practice(0), destination: practice(1) };
  const images = context.photos;
  const menu = context.menuItems.filter((item) => item && typeof item.name === 'string' && item.name.trim())
    .slice(0, 4).map((item): PlayObject => ({
    name: item.name,
    uri: images.find((entry) => entry && entry.id === item.photoId && entry.source === 'OWNER_PHOTO' && entry.kind === 'MENU')
      ? photo(images.filter((entry) => entry && entry.id === item.photoId), 'MENU', apiUrl) : undefined,
    source: 'menu',
  }));
  const signUri = photo(images, 'SIGN', apiUrl);
  const sign: PlayObject = signUri ? { name: `${context.merchantName} 간판`, uri: signUri, source: 'sign' } : practice(4);
  const collectible: PlayObject = owned ? { name: owned.name, uri: owned.uri, source: 'collectible' } : practice(5);
  const packageUri = photo(images, 'PACKAGING', apiUrl);
  return {
    merchantName: context.merchantName, roadAddress: context.roadAddress, contentVersion: context.profileVersion,
    tokens: Array.from({ length: 6 }, (_, index) => menu[index] ?? (index === 4 ? sign : index === 5 ? collectible : practice(index))),
    package: packageUri ? { name: `${context.merchantName} 포장`, uri: packageUri, source: 'packaging' } : collectible,
    destination: signUri ? sign : { name: `${context.merchantName} · 간판 사진 없음`, source: 'merchant' },
  };
}
