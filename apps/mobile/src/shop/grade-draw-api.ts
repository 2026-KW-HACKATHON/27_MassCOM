import { parseCollectibleArtwork, type CollectibleArtwork } from '@/commerce/collectible-artwork';
import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { ShopApiError, isMileageGrade, type MileageGrade } from './shop-api';

export type GradeReward =
  | { kind: 'CHARACTER'; id: string; name: string }
  | { kind: 'THEME'; id: string; name: string; slot: 'hat' | 'bag' | 'prop' | 'pose' | 'decor' }
  | { kind: 'COIN'; id: string; name: string; publicationId: string; gradeId: string; merchantId: string; merchantName: string; artwork?: CollectibleArtwork };
export type GradeDrawPool = { grade: MileageGrade; price: number; version: string; total: number; probabilityPerItem: number;
  rewards: GradeReward[]; counts: { COIN: number; THEME: number; CHARACTER: number } };
export type GradeDrawResult = { drawId: string; grade: MileageGrade; price: number; reward: GradeReward;
  duplicate: boolean; quantity: number; balance: number; replayed: boolean };
export type GradeDrawShop = { balance: number; pools: GradeDrawPool[];
  history: { drawId: string; grade: MileageGrade; price: number; reward: GradeReward; createdAt: string }[] };

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function string(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function invalid(): never { throw new ShopApiError(200, 'INVALID_RESPONSE'); }

function reward(value: unknown): GradeReward {
  if (!object(value) || !string(value.id) || !string(value.name)) return invalid();
  if (value.kind === 'CHARACTER') return { kind: 'CHARACTER', id: value.id, name: value.name };
  if (value.kind === 'THEME' && ['hat', 'bag', 'prop', 'pose', 'decor'].includes(String(value.slot)))
    return { kind: 'THEME', id: value.id, name: value.name, slot: value.slot as Extract<GradeReward, { kind: 'THEME' }>['slot'] };
  if (value.kind === 'COIN' && string(value.publicationId) && string(value.gradeId) && string(value.merchantId) && string(value.merchantName)) {
    const artwork = parseCollectibleArtwork(value.artwork);
    return { kind: 'COIN', id: value.id, name: value.name, publicationId: value.publicationId, gradeId: value.gradeId,
      merchantId: value.merchantId, merchantName: value.merchantName, ...(artwork ? { artwork } : {}) };
  }
  return invalid();
}

export function parseGradeDrawShop(value: unknown): GradeDrawShop {
  if (!object(value) || !Number.isSafeInteger(value.balance) || !Array.isArray(value.pools) || !Array.isArray(value.history)) return invalid();
  return { balance: value.balance as number, pools: value.pools.map((item: unknown) => {
    if (!object(item) || !isMileageGrade(item.grade) || !integer(item.price) || !string(item.version)
      || !integer(item.total) || !Array.isArray(item.rewards) || !object(item.counts)
      || !['COIN', 'THEME', 'CHARACTER'].every((key) => integer((item.counts as Record<string, unknown>)[key]))
      || typeof item.probabilityPerItem !== 'number' || !Number.isFinite(item.probabilityPerItem)) return invalid();
    const rewards = item.rewards.map(reward);
    if (item.total !== rewards.length || item.total < 1 || Math.abs(item.probabilityPerItem * item.total - 1) > 1e-9
      || (item.counts.COIN as number) !== rewards.filter((entry) => entry.kind === 'COIN').length
      || (item.counts.THEME as number) !== rewards.filter((entry) => entry.kind === 'THEME').length
      || (item.counts.CHARACTER as number) !== rewards.filter((entry) => entry.kind === 'CHARACTER').length) return invalid();
    return { grade: item.grade, price: item.price, version: item.version, total: item.total, probabilityPerItem: item.probabilityPerItem,
      rewards, counts: item.counts as GradeDrawPool['counts'] };
  }), history: value.history.map((item: unknown) => {
    if (!object(item) || !string(item.drawId) || !isMileageGrade(item.grade) || !integer(item.price)
      || !string(item.createdAt) || Number.isNaN(Date.parse(item.createdAt))) return invalid();
    return { drawId: item.drawId, grade: item.grade, price: item.price, reward: reward(item.reward), createdAt: item.createdAt };
  }) };
}

export function parseGradeDrawResult(value: unknown): GradeDrawResult {
  if (!object(value) || !string(value.drawId) || !isMileageGrade(value.grade) || !integer(value.price)
    || typeof value.duplicate !== 'boolean' || !integer(value.quantity) || value.quantity < 1
    || !Number.isSafeInteger(value.balance) || typeof value.replayed !== 'boolean') return invalid();
  return { drawId: value.drawId, grade: value.grade, price: value.price, reward: reward(value.reward), duplicate: value.duplicate,
    quantity: value.quantity, balance: value.balance as number, replayed: value.replayed };
}

export function createGradeDrawApi(input: { apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => Promise<void>; fetcher?: typeof fetch }) {
  const fetcher = input.fetcher ?? fetch;
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`${input.apiUrl.replace(/\/+$/, '')}${path}`, { ...init,
        headers: { Accept: 'application/json', ...headersForCredential(input.credential), ...(init?.headers as Record<string, string> | undefined) } });
    } catch { throw new ShopApiError(0, 'NETWORK_ERROR'); }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = object(body) && string(body.code) ? body.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(input.credential, response.status, code)) await input.onSessionInvalid?.();
      throw new ShopApiError(response.status, code);
    }
    return body;
  }
  return {
    getShop: async () => parseGradeDrawShop(await request('/shop/draw-pools')),
    draw: async (body: { grade: MileageGrade; requestId: string; expectedPoolVersion: string }) => parseGradeDrawResult(await request('/shop/draws', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}
