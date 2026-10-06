import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { consentRequiredMessage, needsConsentRecheck } from '@/privacy/consent-flow';
import { parseCollectibleArtwork, type CollectibleArtwork } from '@/commerce/collectible-artwork';

export type StudioTheme = 'daylight' | 'evening' | 'garden';
export type StudioLayout = 'shelf' | 'gallery';
export type StudioAccent = 'mint' | 'rose' | 'sky';
export type StudioGoal = null | { kind: 'discover' | 'regular' | 'series' | 'collectible' | 'play'; merchantId?: string;
  gameKind?: string; campaignId?: string; publicationId?: string; targetVisitCount?: 1 | 3 | 5 };
export type Studio = { theme: StudioTheme; layout: StudioLayout; accent: StudioAccent; slots: string[]; goal: StudioGoal };
export type PublicStudio = Omit<Studio, 'slots'>;
export type StudioItem = { entitlementId?: string; merchantId: string; merchantName: string; campaignTitle: string; displayName: string; artwork?: CollectibleArtwork };
export type StudioRecord = { kind: string; bestScore: number; plays: number; version2BestScore?: number; version2Plays?: number };
export type StudioSnapshot = { studio: Studio; items: StudioItem[]; avatar: string | null; records: StudioRecord[]; unlockedThemes: StudioTheme[] };
export type FriendStudioSnapshot = { nickname: string; studio: PublicStudio; items: StudioItem[]; avatar: string | null; avatarClothingId?: string | null };

export const defaultStudio: Studio = { theme: 'daylight', layout: 'shelf', accent: 'mint', slots: [], goal: null };
const themes: readonly string[] = ['daylight', 'evening', 'garden'];
const layouts: readonly string[] = ['shelf', 'gallery'];
const accents: readonly string[] = ['mint', 'rose', 'sky'];
const kinds: readonly string[] = ['discover', 'regular', 'series', 'collectible', 'play'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseStudio(value: unknown, friend: false): Studio;
function parseStudio(value: unknown, friend: true): PublicStudio;
function parseStudio(value: unknown, friend: boolean): Studio | PublicStudio {
  if (!record(value) || !themes.includes(value.theme as string) || !layouts.includes(value.layout as string) || !accents.includes(value.accent as string)) throw new Error('INVALID_STUDIO');
  const goal = value.goal;
  if (goal !== null && (!record(goal) || !kinds.includes(goal.kind as string)
    || (goal.merchantId !== undefined && !string(goal.merchantId))
    || (goal.gameKind !== undefined && !string(goal.gameKind))
    || (goal.kind === 'collectible' && (!string(goal.campaignId) || !string(goal.publicationId)
      || ![1, 3, 5].includes(goal.targetVisitCount as number)
      || Object.keys(goal).sort().join(',') !== 'campaignId,kind,merchantId,publicationId,targetVisitCount')))) throw new Error('INVALID_STUDIO');
  const base: PublicStudio = {
    theme: value.theme as StudioTheme, layout: value.layout as StudioLayout, accent: value.accent as StudioAccent,
    goal: goal as StudioGoal,
  };
  if (friend) return base;
  if (!Array.isArray(value.slots) || value.slots.length > 6 || !value.slots.every(string)
    || new Set(value.slots).size !== value.slots.length) throw new Error('INVALID_STUDIO');
  return { ...base, slots: value.slots };
}

function parseItems(value: unknown, friend: boolean): StudioItem[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('INVALID_STUDIO_ITEMS');
  return value.map((item: unknown) => {
    if (!record(item) || (!friend && !string(item.entitlementId)) || !string(item.merchantId)
      || !string(item.merchantName) || !string(item.campaignTitle) || !string(item.displayName)) throw new Error('INVALID_STUDIO_ITEMS');
    const artwork = parseCollectibleArtwork(item.artwork);
    return {
      ...(!friend ? { entitlementId: item.entitlementId as string } : {}),
      merchantId: item.merchantId, merchantName: item.merchantName,
      campaignTitle: item.campaignTitle, displayName: item.displayName,
      ...(artwork ? { artwork } : {}),
    };
  });
}

function parseAvatar(value: unknown): string | null {
  if (value === null || string(value)) return value as string | null;
  throw new Error('INVALID_STUDIO_AVATAR');
}

export function parseStudioSnapshot(value: unknown): StudioSnapshot {
  if (!record(value) || !Array.isArray(value.records) || !Array.isArray(value.unlockedThemes)) throw new Error('INVALID_STUDIO');
  const records = value.records.map((entry: unknown) => {
    if (!record(entry) || !string(entry.kind) || !integer(entry.bestScore) || !integer(entry.plays)
      || entry.version2BestScore !== undefined && !integer(entry.version2BestScore)
      || entry.version2Plays !== undefined && (!integer(entry.version2Plays) || entry.version2Plays > entry.plays)
      || (entry.version2BestScore === undefined) !== (entry.version2Plays === undefined)) throw new Error('INVALID_STUDIO_RECORD');
    return { kind: entry.kind, bestScore: entry.bestScore as number, plays: entry.plays as number,
      ...(entry.version2BestScore !== undefined ? { version2BestScore: entry.version2BestScore as number } : {}),
      ...(entry.version2Plays !== undefined ? { version2Plays: entry.version2Plays as number } : {}) };
  });
  if (!value.unlockedThemes.every((theme: unknown) => themes.includes(theme as string))) throw new Error('INVALID_STUDIO_THEMES');
  return {
    studio: parseStudio(value.studio, false), items: parseItems(value.items, false), avatar: parseAvatar(value.avatar),
    records, unlockedThemes: value.unlockedThemes as StudioTheme[],
  };
}

export function parseFriendStudioSnapshot(value: unknown): FriendStudioSnapshot {
  if (!record(value) || !string(value.nickname)) throw new Error('INVALID_FRIEND_STUDIO');
  if (value.avatarClothingId !== undefined && value.avatarClothingId !== null
    && (!string(value.avatarClothingId) || value.avatarClothingId.length > 80)) throw new Error('INVALID_FRIEND_STUDIO');
  return {
    nickname: value.nickname, studio: parseStudio(value.studio, true),
    items: parseItems(value.items, true), avatar: parseAvatar(value.avatar),
    ...(value.avatarClothingId !== undefined ? { avatarClothingId: value.avatarClothingId as string | null } : {}),
  };
}

export class StudioApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function studioErrorMessage(error: unknown): string {
  if (needsConsentRecheck(error)) return consentRequiredMessage;
  if (error instanceof Error && error.message === 'NETWORK_ERROR') return '연결을 확인하고 다시 시도해 주세요.';
  if (error instanceof Error && error.message === 'INVALID_STUDIO') return '공간 정보가 올바르지 않아요. 다시 불러와 주세요.';
  return '공간을 불러오거나 저장하지 못했어요. 다시 시도해 주세요.';
}

export function createStudioApiClient(options: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch;
}) {
  const fetcher = options.fetcher ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, '');
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { ...init, headers }); }
    catch { throw new StudioApiError(0, 'NETWORK_ERROR'); }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (!response.ok) {
      const code = record(payload) && string(payload.code) ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new StudioApiError(response.status, code);
    }
    return payload;
  }
  return {
    getMine: async () => parseStudioSnapshot(await request('/me/studio')),
    save: async (studio: Studio) => parseStudioSnapshot(await request('/me/studio', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studio }),
    })),
    getFriend: async (friendshipId: string) => parseFriendStudioSnapshot(await request(`/friends/${encodeURIComponent(friendshipId)}/studio`)),
    trackShare: async (event: 'share-open' | 'image-created') => {
      await request('/me/play/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }),
      });
    },
  };
}
