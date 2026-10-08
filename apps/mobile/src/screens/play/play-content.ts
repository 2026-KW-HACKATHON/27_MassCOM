import type { RealGameContext, MerchantPhoto } from '../../../../api/src/real-world-contract';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { buildStoreSeries, type SeriesSlot } from '../collection/store-series';
import type { OwnedArt } from './play-art';

/** merchantId/merchantName name the store a token came from; entitlementId and nextSlot exist only on a store's coin. */
export type PlayObject = {
  name: string; uri?: string; source: 'menu' | 'sign' | 'merchant' | 'packaging' | 'collectible' | 'practice';
  merchantId?: string; merchantName?: string; entitlementId?: string; nextSlot?: SeriesSlot;
};
export type PlayContent = {
  merchantId?: string;
  merchantName?: string;
  roadAddress?: string;
  contentVersion?: number;
  tokens: PlayObject[];
  /** The memory game's six cards: distinct visited stores' coins, then practice pictures. Menu tokens stay in `tokens`. */
  memoryTokens: PlayObject[];
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

const validGoals = (value: unknown): value is { targetVisitCount: 1 | 3 | 5; displayName: string }[] => Array.isArray(value) &&
  value.every((goal) => record(goal) && (goal.targetVisitCount === 1 || goal.targetVisitCount === 3 || goal.targetVisitCount === 5) &&
    typeof goal.displayName === 'string' && !!goal.displayName.trim());

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

/** The server accepts at most 20 stores per game-content request (see fetchPlayContent). */
const maxStores = 20;

/** One entry per visited store: its first coin with artwork (the server lists the highest stage first). */
export function ownedGameArt(collection: CollectionSnapshot | undefined): OwnedArt[] {
  const collectibles = collection?.collectibles ?? [];
  const result: OwnedArt[] = [];
  const seen = new Set<string>();
  for (const collectible of collectibles) {
    const artwork = collectible.artwork;
    if (!artwork || seen.has(collectible.merchantId)) continue;
    seen.add(collectible.merchantId);
    result.push({
      name: artwork.name, uri: artwork.thumbnailDataUrl, merchantId: collectible.merchantId, merchantName: collectible.merchantName,
      entitlementId: collectible.entitlementId,
      held: collectibles.filter((item) => item.merchantId === collectible.merchantId)
        .map(({ entitlementId, campaignId, targetVisitCount }) => ({ entitlementId, campaignId, targetVisitCount })),
    });
    if (result.length === maxStores) break;
  }
  return result;
}

/**
 * The store's next collectible, only while its current campaign can still hand one out and the account's holdings are known.
 * The campaign is a cosmetic extra of the game content, so a malformed one drops this line instead of rejecting the content.
 */
function nextSlotFor(item: OwnedArt, context: RealGameContext): SeriesSlot | undefined {
  const campaign: unknown = context.campaign;
  if (!item.merchantId || !item.held || !record(campaign) || campaign.rewardAvailability !== 'AVAILABLE' ||
    typeof campaign.id !== 'string' || !validGoals(campaign.goals)) return undefined;
  const merchantId = item.merchantId;
  const [series] = buildStoreSeries(
    [{ id: context.merchantId, name: context.merchantName, campaign: { id: campaign.id, rewardGoals: campaign.goals } }],
    item.held.map((held) => ({ ...held, merchantId, appCollectibleStatus: 'COLLECTED' as const })),
  );
  return series?.nextSlot ?? undefined;
}

const kstDay = (at: Date) => Math.floor((at.getTime() + 9 * 3_600_000) / 86_400_000);

/**
 * Coins of up to six distinct stores that still have a published context and a coin picture no other store already uses;
 * the rest of the six cards are practice pictures. With more than six stores the window of six starts at a different store
 * each KST day, so every visited store comes up over time while one run (and its retry) keeps the same cards.
 */
function memoryTokens(art: readonly OwnedArt[], contexts: readonly RealGameContext[], today: Date): PlayObject[] {
  const coins: PlayObject[] = [];
  const stores = new Set<string>();
  const pictures = new Set<string>();
  for (const item of art) {
    const context = item.merchantId ? contexts.find((entry) => entry.merchantId === item.merchantId) : undefined;
    if (!item.merchantId || !context || stores.has(item.merchantId) || pictures.has(item.uri)) continue;
    stores.add(item.merchantId);
    pictures.add(item.uri);
    const nextSlot = nextSlotFor(item, context);
    coins.push({
      name: item.name, uri: item.uri, source: 'collectible', merchantId: item.merchantId, merchantName: context.merchantName,
      ...(item.entitlementId ? { entitlementId: item.entitlementId } : {}), ...(nextSlot ? { nextSlot } : {}),
    });
  }
  const start = coins.length > 6 ? kstDay(today) % coins.length : 0;
  const shown = [...coins.slice(start), ...coins.slice(0, start)].slice(0, 6);
  return Array.from({ length: 6 }, (_, index) => shown[index] ?? practice(index));
}

/** Opens the coin's 도감 entry; a coin without a known entitlement has nowhere to go. */
export function coinEntryRoute(item: PlayObject) {
  return item.entitlementId ? { pathname: '/collection', params: { focus: 'collectible', entitlement: item.entitlementId } } as const : undefined;
}

/** Only content built from a known store can lead to that store's detail page. */
export function merchantDetailRoute(content: Pick<PlayContent, 'merchantId'>) {
  return content.merchantId ? { pathname: '/merchants/[merchantId]', params: { merchantId: content.merchantId } } as const : undefined;
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
export function playContent(art: readonly OwnedArt[], contexts: readonly RealGameContext[], apiUrl: string, today = new Date()): PlayContent {
  const owned = art.find((item) => item.merchantId && contexts.some((context) => context.merchantId === item.merchantId));
  const context = contexts.find((item) => item.merchantId === owned?.merchantId);
  const coins = memoryTokens(art, contexts, today);
  if (!context) return { tokens: Array.from({ length: 6 }, (_, index) => practice(index)), memoryTokens: coins, package: practice(0), destination: practice(1) };
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
    merchantId: context.merchantId, merchantName: context.merchantName, roadAddress: context.roadAddress, contentVersion: context.profileVersion,
    tokens: Array.from({ length: 6 }, (_, index) => menu[index] ?? (index === 4 ? sign : index === 5 ? collectible : practice(index))),
    memoryTokens: coins,
    package: packageUri ? { name: `${context.merchantName} 포장`, uri: packageUri, source: 'packaging' } : collectible,
    destination: signUri ? sign : { name: `${context.merchantName} · 간판 사진 없음`, source: 'merchant' },
  };
}
