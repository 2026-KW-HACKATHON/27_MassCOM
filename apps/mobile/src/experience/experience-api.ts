import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { parseCollectibleArtwork, type CollectibleArtwork } from '@/commerce/collectible-artwork';
import { shouldInvalidateSession } from '@/auth/session-invalid';

export type CosmeticSlot = 'hat' | 'bag' | 'prop' | 'pose' | 'decor';
export type ExperienceProfile = {
  badgeId: string | null;
  cosmetics: Record<CosmeticSlot, string | null>;
  coinEntitlementId: string | null;
  wishlist: string | null;
};
export type DisplayExperienceProfile = Pick<ExperienceProfile, 'badgeId' | 'cosmetics'> & {
  badgeName?: string | null;
  coinEntitlementId?: string | null;
  coin?: { merchantId: string; merchantName: string; campaignTitle: string; displayName: string; artwork?: CollectibleArtwork } | null;
};
export type EquipmentPatch = { badgeId?: string | null; cosmetics?: Partial<Record<CosmeticSlot, string | null>>; coinEntitlementId?: string | null };
export type ExperienceSnapshot = {
  catalog: {
    badges: { id: string; name: string; kind: 'visit' | 'game'; tier?: 1 | 2 | 3; unlockItemIds: string[] }[];
    cosmetics: { id: string; name: string; slot: CosmeticSlot; source: { kind: 'badge'; badgeId: string } | { kind: 'pack'; packId: string } }[];
    packs: { id: string; name: string; theme: string; grade: 'BRONZE' | 'SILVER' | 'GOLD'; price: number; bonusItemIds: string[] }[];
  };
  profile: ExperienceProfile;
  progress: {
    badges: { id: string; value: number; target: number; owned: boolean; nextAction: string }[];
    cosmetics: { id: string; owned: boolean; equippable: boolean }[];
    packs: { id: string; opens: number; ownedBonuses: number; totalBonuses: number }[];
  };
};

export class ExperienceApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function parseExperienceSnapshot(value: unknown): ExperienceSnapshot {
  if (!record(value) || !record(value.catalog) || !record(value.profile) || !record(value.progress) ||
    !Array.isArray(value.catalog.badges) || !Array.isArray(value.catalog.cosmetics) || !Array.isArray(value.catalog.packs) ||
    !Array.isArray(value.progress.badges) || !Array.isArray(value.progress.cosmetics) || !Array.isArray(value.progress.packs) ||
    !record(value.profile.cosmetics)) throw new ExperienceApiError(200, 'INVALID_EXPERIENCE');
  const catalog = value.catalog as { badges: unknown[]; cosmetics: unknown[]; packs: unknown[] };
  const progress = value.progress as { badges: unknown[]; cosmetics: unknown[]; packs: unknown[] };
  const profile = value.profile;
  if (!nullableString(profile.badgeId) || !nullableString(profile.coinEntitlementId) || !nullableString(profile.wishlist) ||
    !(['hat', 'bag', 'prop', 'pose', 'decor'] as const).every((slot) => nullableString((profile.cosmetics as Record<string, unknown>)[slot])) ||
    !catalog.badges.every((item: unknown) => record(item) && string(item.id) && string(item.name) && (item.kind === 'visit' || item.kind === 'game') && Array.isArray(item.unlockItemIds) && item.unlockItemIds.every(string)) ||
    !catalog.cosmetics.every((item: unknown) => record(item) && string(item.id) && string(item.name) && ['hat', 'bag', 'prop', 'pose', 'decor'].includes(item.slot as string) && record(item.source) &&
      ((item.source.kind === 'badge' && string(item.source.badgeId)) || (item.source.kind === 'pack' && string(item.source.packId)))) ||
    !catalog.packs.every((item: unknown) => record(item) && string(item.id) && string(item.name) && string(item.theme) && ['BRONZE', 'SILVER', 'GOLD'].includes(item.grade as string) && count(item.price) && Array.isArray(item.bonusItemIds) && item.bonusItemIds.every(string)) ||
    !progress.badges.every((item: unknown) => record(item) && string(item.id) && count(item.value) && count(item.target) && typeof item.owned === 'boolean' && typeof item.nextAction === 'string') ||
    !progress.cosmetics.every((item: unknown) => record(item) && string(item.id) && typeof item.owned === 'boolean' && typeof item.equippable === 'boolean') ||
    !progress.packs.every((item: unknown) => record(item) && string(item.id) && count(item.opens) && count(item.ownedBonuses) && count(item.totalBonuses))) throw new ExperienceApiError(200, 'INVALID_EXPERIENCE');
  return value as ExperienceSnapshot;
}

export function parseDisplayExperienceProfile(value: unknown): DisplayExperienceProfile {
  if (!record(value) || !record(value.cosmetics)) throw new ExperienceApiError(200, 'INVALID_EXPERIENCE');
  const cosmetics = value.cosmetics;
  if (
    !(value.badgeId === null || typeof value.badgeId === 'string') ||
    !(value.badgeName === undefined || value.badgeName === null || typeof value.badgeName === 'string') ||
    !(value.coin === null || (record(value.coin) && ['merchantId', 'merchantName', 'campaignTitle', 'displayName'].every((key) => typeof (value.coin as Record<string, unknown>)[key] === 'string'))) ||
    !(['hat', 'bag', 'prop', 'pose', 'decor'] as const).every((slot) => cosmetics[slot] === null || typeof cosmetics[slot] === 'string'))
    throw new ExperienceApiError(200, 'INVALID_EXPERIENCE');
  const profile = value as DisplayExperienceProfile;
  const coin = record(value.coin) ? value.coin : null;
  const artwork = coin ? parseCollectibleArtwork(coin.artwork) : undefined;
  return { badgeId: profile.badgeId, badgeName: profile.badgeName ?? null, cosmetics: profile.cosmetics,
    coin: coin ? { merchantId: coin.merchantId as string, merchantName: coin.merchantName as string,
      campaignTitle: coin.campaignTitle as string, displayName: coin.displayName as string,
      ...(artwork ? { artwork } : {}) } : null };
}

export function createExperienceApiClient(options: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch;
}) {
  const base = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  async function request(path: string, init?: RequestInit): Promise<ExperienceSnapshot> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { ...init, headers }); }
    catch { throw new ExperienceApiError(0, 'NETWORK_ERROR'); }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = undefined; }
    if (!response.ok) {
      const code = record(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new ExperienceApiError(response.status, code);
    }
    return parseExperienceSnapshot(payload);
  }
  const patch = (path: string, body: unknown) => request(path, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return {
    get: () => request('/me/experience'),
    equip: (equipment: EquipmentPatch) => patch('/me/experience/equipment', equipment),
    wish: (itemId: string | null) => patch('/me/experience/wishlist', { itemId }),
    getFriend: async (friendshipId: string): Promise<DisplayExperienceProfile> => {
      const headers = new Headers({ Accept: 'application/json' });
      for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
      const response = await fetcher(`${base}/me/friends/${encodeURIComponent(friendshipId)}/experience`, { headers });
      const payload: unknown = await response.json();
      if (!response.ok) throw new ExperienceApiError(response.status, record(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`);
      return parseDisplayExperienceProfile(payload);
    },
  };
}
