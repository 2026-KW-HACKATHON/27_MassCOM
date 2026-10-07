import type { OwnerOfferConsent } from './store-go-live-rules.js';

export type CoinTicketGrade = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export type CoinReference = { publicationId: string; gradeId: string };
export type CoinPoolEntry = CoinReference & { name: string; weight: number; probability: number; summary: Record<string, unknown> };
export type CoinPool = {
  id: string; merchantId: string; merchantName: string; eventName: string; grade: CoinTicketGrade;
  price: number; purchaseStartsAt: string; purchaseEndsAt: string; useExpiresAt: string;
  perAccountLimit: number; issuanceCap: number; issuedCount: number; status: 'ACTIVE' | 'PAUSED';
  unavailableReason?: 'MEDIA_REMOVED' | 'PUBLICATION_UNAVAILABLE';
  entries: CoinPoolEntry[];
};
export type CoinTicket = {
  id: string; poolId: string; merchantId: string; eventName: string; grade: CoinTicketGrade;
  acquiredAt: string; expiresAt: string; status: 'UNUSED' | 'USED' | 'EXPIRED';
};
export type CoinOwned = CoinReference & { name: string; summary: Record<string, unknown>; quantity: number; visitQuantity: number; drawQuantity: number };
export type CoinSeriesSlot = CoinReference & { name: string; quantity: number };
export type CoinSeries = {
  id: string; title: string; merchantId: string; merchantName: string; endsAt: string;
  base: { slots: CoinSeriesSlot[]; complete: boolean; title: string; detail: string };
  prism: { slots: CoinSeriesSlot[]; complete: boolean; title: string; detail: string };
  claimable: 'BASE' | 'PRISM' | null;
  coupon: { id: string; tier: 'BASE' | 'PRISM'; title: string; detail: string; expiresAt: string; status: 'ISSUED' | 'REDEEMED' | 'EXPIRED'; redeemedAt: string | null } | null;
};
export type CoinShop = { mileage: { earned: number; spent: number; balance: number }; pools: CoinPool[]; tickets: CoinTicket[] };
export type CoinCollection = { coins: CoinOwned[]; series: CoinSeries[] };
export type PurchasedCoinTicket = { ticket: CoinTicket; balance: number; replayed: boolean };
export type UsedCoinTicket = { ticket: CoinTicket; coin: CoinOwned; replayed: boolean };
export type ClaimedCoinSeries = { series: CoinSeries; replayed: boolean };

export type PublishCoinPoolInput = {
  actorAccountId: string; merchantId: string; eventName: string; grade: CoinTicketGrade;
  price: number; purchaseStartsAt: string; purchaseEndsAt: string; useExpiresAt: string;
  perAccountLimit: number; issuanceCap: number;
  entries: (CoinReference & { weight: number })[];
};
export type PublishCoinSeriesInput = {
  actorAccountId: string; merchantId: string; title: string; endsAt: string;
  baseCoins: CoinReference[]; prismCoins: CoinReference[];
  baseCoupon: { title: string; detail: string; validDays: number; issuanceCap: number };
  prismCoupon: { title: string; detail: string; validDays: number; issuanceCap: number };
  consentDocumentRef: string;
  consent: OwnerOfferConsent;
};

export interface CoinEconomyService {
  getShop(accountId: string): Promise<CoinShop>;
  purchase(input: { accountId: string; poolId: string; requestId: string }): Promise<PurchasedCoinTicket>;
  useTicket(input: { accountId: string; ticketId: string }): Promise<UsedCoinTicket>;
  getCollection(accountId: string): Promise<CoinCollection>;
  claimSeries(input: { accountId: string; seriesId: string }): Promise<ClaimedCoinSeries>;
  publishPool(input: PublishCoinPoolInput): Promise<CoinPool>;
  publishSeries(input: PublishCoinSeriesInput): Promise<CoinSeries>;
  pausePool(input: { actorAccountId: string; poolId: string }): Promise<CoinPool>;
  grantTicket(input: { actorAccountId: string; accountId: string; poolId: string; requestId: string }): Promise<PurchasedCoinTicket>;
}

export type CoinEconomyErrorCode =
  | 'INVALID_REQUEST' | 'ACCOUNT_DELETED' | 'COIN_POOL_UNAVAILABLE' | 'COIN_POOL_EXPIRED'
  | 'COIN_POOL_LIMIT_REACHED' | 'COIN_INSUFFICIENT_MILEAGE' | 'COIN_REQUEST_CONFLICT'
  | 'COIN_TICKET_NOT_FOUND' | 'COIN_TICKET_EXPIRED' | 'COIN_SERIES_UNAVAILABLE'
  | 'COIN_SERIES_INCOMPLETE' | 'COIN_SERIES_CAP_REACHED' | 'COIN_PUBLICATION_UNAVAILABLE';

export class CoinEconomyError extends Error {
  constructor(readonly code: CoinEconomyErrorCode) { super(code); this.name = 'CoinEconomyError'; }
}
