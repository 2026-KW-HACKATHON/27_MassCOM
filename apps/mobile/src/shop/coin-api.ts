import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

export type CoinGrade = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
export type CoinEntry = { publicationId: string; gradeId: string; name: string; weight: number; probability: number; summary: Record<string, unknown> };
export type CoinPool = { id: string; merchantId: string; merchantName: string; eventName: string; grade: CoinGrade; price: number;
  purchaseStartsAt: string; purchaseEndsAt: string; useExpiresAt: string; perAccountLimit: number; issuanceCap: number;
  issuedCount: number; status: 'ACTIVE' | 'PAUSED'; unavailableReason?: 'MEDIA_REMOVED' | 'PUBLICATION_UNAVAILABLE'; entries: CoinEntry[] };
export type CoinTicket = { id: string; poolId: string; merchantId: string; eventName: string; grade: CoinGrade;
  acquiredAt: string; expiresAt: string; status: 'UNUSED' | 'USED' | 'EXPIRED' };
export type OwnedCoin = { publicationId: string; gradeId: string; name: string; summary: Record<string, unknown>;
  quantity: number; visitQuantity: number; drawQuantity: number };
export type CoinSeries = { id: string; title: string; merchantId: string; merchantName: string; endsAt: string;
  base: SeriesTier; prism: SeriesTier; claimable: 'BASE' | 'PRISM' | null;
  coupon: null | { id: string; tier: 'BASE' | 'PRISM'; title: string; detail: string; expiresAt: string;
    status: 'ISSUED' | 'REDEEMED' | 'EXPIRED'; redeemedAt: string | null } };
export type SeriesTier = { slots: { publicationId: string; gradeId: string; name: string; quantity: number }[];
  complete: boolean; title: string; detail: string };
export type CoinShop = { mileage: { earned: number; spent: number; balance: number }; pools: CoinPool[]; tickets: CoinTicket[] };
export type CoinCollection = { coins: OwnedCoin[]; series: CoinSeries[] };

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const grade = (v: unknown): v is CoinGrade => ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].includes(v as string);
const oneOf = (v: unknown, values: readonly string[]): boolean => values.includes(v as string);
const invalid = (): Error => new Error('INVALID_COIN_RESPONSE');

export function parseCoinShop(v: unknown): CoinShop {
  if (!record(v) || !record(v.mileage) || !num(v.mileage.earned) || !num(v.mileage.spent)
    || typeof v.mileage.balance !== 'number' || !Number.isSafeInteger(v.mileage.balance)
    || !Array.isArray(v.pools) || !Array.isArray(v.tickets)) throw invalid();
  return { mileage: v.mileage as CoinShop['mileage'], pools: v.pools.map(parsePool), tickets: v.tickets.map(parseTicket) };
}

function parsePool(v: unknown): CoinPool {
  if (!record(v) || !str(v.id) || !str(v.merchantId) || !str(v.merchantName) || !str(v.eventName) || !grade(v.grade)
    || !num(v.price) || !date(v.purchaseStartsAt) || !date(v.purchaseEndsAt) || !date(v.useExpiresAt)
    || !num(v.perAccountLimit) || !num(v.issuanceCap) || !num(v.issuedCount)
    || !oneOf(v.status, ['ACTIVE', 'PAUSED']) || (v.unavailableReason !== undefined && !oneOf(v.unavailableReason, ['MEDIA_REMOVED', 'PUBLICATION_UNAVAILABLE']))
    || !Array.isArray(v.entries) || !v.entries.length) throw invalid();
  return { ...v, entries: v.entries.map((entry: unknown) => {
    if (!record(entry) || !str(entry.publicationId) || !str(entry.gradeId) || !str(entry.name)
      || !num(entry.weight) || entry.weight === 0 || typeof entry.probability !== 'number'
      || !Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 1 || !record(entry.summary)) throw invalid();
    return entry as CoinEntry;
  }) } as CoinPool;
}

function parseTicket(v: unknown): CoinTicket {
  if (!record(v) || !str(v.id) || !str(v.poolId) || !str(v.merchantId) || !str(v.eventName)
    || !grade(v.grade) || !date(v.acquiredAt) || !date(v.expiresAt)
    || !oneOf(v.status, ['UNUSED', 'USED', 'EXPIRED'])) throw invalid();
  return v as CoinTicket;
}

export function parseCoinCollection(v: unknown): CoinCollection {
  if (!record(v) || !Array.isArray(v.coins) || !Array.isArray(v.series)) throw invalid();
  return { coins: v.coins.map((coin: unknown) => {
    if (!record(coin) || !str(coin.publicationId) || !str(coin.gradeId) || !str(coin.name) || !record(coin.summary)
      || !num(coin.quantity) || !num(coin.visitQuantity) || !num(coin.drawQuantity)
      || coin.quantity !== coin.visitQuantity + coin.drawQuantity) throw invalid();
    return coin as OwnedCoin;
  }), series: v.series.map(parseSeries) };
}

function parseTier(v: unknown): SeriesTier {
  if (!record(v) || !str(v.title) || !str(v.detail) || typeof v.complete !== 'boolean' || !Array.isArray(v.slots)) throw invalid();
  return { title: v.title, detail: v.detail, complete: v.complete, slots: v.slots.map((slot: unknown) => {
    if (!record(slot) || !str(slot.publicationId) || !str(slot.gradeId) || !str(slot.name) || !num(slot.quantity)) throw invalid();
    return slot as SeriesTier['slots'][number];
  }) };
}

function parseSeries(v: unknown): CoinSeries {
  if (!record(v) || !str(v.id) || !str(v.title) || !str(v.merchantId) || !str(v.merchantName)
    || !date(v.endsAt) || !oneOf(v.claimable, ['BASE', 'PRISM', null as never])) throw invalid();
  const coupon = v.coupon;
  if (coupon !== null && (!record(coupon) || !str(coupon.id) || !oneOf(coupon.tier, ['BASE', 'PRISM'])
    || !str(coupon.title) || !str(coupon.detail) || !date(coupon.expiresAt)
    || !oneOf(coupon.status, ['ISSUED', 'REDEEMED', 'EXPIRED'])
    || (coupon.redeemedAt !== null && !date(coupon.redeemedAt)))) throw invalid();
  return { id: v.id, title: v.title, merchantId: v.merchantId, merchantName: v.merchantName, endsAt: v.endsAt,
    base: parseTier(v.base), prism: parseTier(v.prism), claimable: v.claimable as CoinSeries['claimable'],
    coupon: coupon as CoinSeries['coupon'] };
}

export class CoinApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'CoinApiError'; }
}

export function coinErrorMessage(error: unknown): string {
  if (error instanceof CoinApiError) {
    const messages: Record<string, string> = {
      NETWORK_ERROR: '연결을 확인해 주세요. 결과가 확실하지 않으면 같은 요청으로 다시 확인합니다.',
      COIN_POOL_UNAVAILABLE: '판매가 중지된 뽑기권이에요.', COIN_POOL_EXPIRED: '구매 기간이 끝났어요.',
      COIN_POOL_LIMIT_REACHED: '구매 가능 수량에 도달했어요.', COIN_INSUFFICIENT_MILEAGE: '마일리지가 부족해요.',
      COIN_TICKET_EXPIRED: '사용 기한이 지난 뽑기권이에요.', COIN_SERIES_INCOMPLETE: '시리즈를 먼저 완성해 주세요.',
      COIN_SERIES_CAP_REACHED: '쿠폰 발행 수량이 마감됐어요.',
    };
    return messages[error.code] ?? '처리하지 못했어요. 새로고침 후 다시 확인해 주세요.';
  }
  return error instanceof Error && error.message === 'INVALID_COIN_RESPONSE'
    ? '응답 형식이 맞지 않아요. 다시 불러와 주세요.' : '처리하지 못했어요. 다시 시도해 주세요.';
}

export function createCoinApiClient(options: { apiUrl: string; credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch }) {
  const fetcher = options.fetcher ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, '');
  async function request(path: string, body?: unknown): Promise<unknown> {
    const headers = new Headers(headersForCredential(options.credential));
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new CoinApiError(0, 'NETWORK_ERROR'); }
    let value: unknown;
    try { value = await response.json(); } catch { value = undefined; }
    if (!response.ok) {
      const code = record(value) && str(value.code) ? value.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new CoinApiError(response.status, code);
    }
    return value;
  }
  return {
    getShop: async (): Promise<CoinShop> => parseCoinShop(await request('/coin-shop')),
    purchase: async (poolId: string, requestId: string) => {
      const v = await request('/coin-shop/purchases', { poolId, requestId });
      if (!record(v) || typeof v.balance !== 'number' || !Number.isSafeInteger(v.balance)
        || typeof v.replayed !== 'boolean') throw invalid();
      return { ticket: parseTicket(v.ticket), balance: v.balance, replayed: v.replayed };
    },
    useTicket: async (ticketId: string) => {
      const v = await request(`/coin-tickets/${encodeURIComponent(ticketId)}/use`, {});
      if (!record(v) || typeof v.replayed !== 'boolean') throw invalid();
      const coin = parseCoinCollection({ coins: [v.coin], series: [] }).coins[0]!;
      return { ticket: parseTicket(v.ticket), coin, replayed: v.replayed };
    },
    getCollection: async (): Promise<CoinCollection> => parseCoinCollection(await request('/me/coins')),
    claimSeries: async (seriesId: string) => {
      const v = await request(`/coin-series/${encodeURIComponent(seriesId)}/claim`, {});
      if (!record(v) || typeof v.replayed !== 'boolean') throw invalid();
      return { series: parseSeries(v.series), replayed: v.replayed };
    },
  };
}
