import type { OwnerOfferConsent } from './store-go-live-rules.js';
import type { CollectibleDetail } from './collectible-project.js';

export type CoinTicketGrade = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export type CoinReference = { publicationId: string; gradeId: string };
export type CoinPoolEntry = CoinReference & { name: string; weight: number; probability: number; remaining?: number; summary: Record<string, unknown> };
export type CoinPool = {
  id: string; merchantId: string; merchantName: string; eventName: string; grade: CoinTicketGrade;
  price: number; purchaseStartsAt: string; purchaseEndsAt: string; useExpiresAt: string;
  perAccountLimit: number; issuanceCap: number; issuedCount: number; status: 'ACTIVE' | 'PAUSED';
  unavailableReason?: 'MEDIA_REMOVED' | 'PUBLICATION_UNAVAILABLE';
  cycle?: number; remaining?: number;
  entries: CoinPoolEntry[];
};
export type CoinTicket = {
  id: string; poolId: string; merchantId: string; eventName: string; grade: CoinTicketGrade;
  acquiredAt: string; expiresAt: string; status: 'UNUSED' | 'USED' | 'EXPIRED';
};
export type CoinOwned = CoinReference & { name: string; summary: Record<string, unknown>; quantity: number; visitQuantity: number; drawQuantity: number; rerollQuantity: number };
export type CoinSourceKind = 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL';
export type CoinSource = CoinReference & { sourceKind: CoinSourceKind; sourceId: string; merchantId: string;
  nftStatus: 'NOT_REQUESTED' | 'PENDING' | 'COMPLETED'; rerollEligible: boolean };
export type CoinCatalog = { merchantId: string; merchantName: string; types: {
  publicationId: string; name: string; grades: (CoinReference & { name: string; summary: Record<string, unknown>;
    quantity: number; sources: CoinSource[] })[] }[] }[];
export type CoinRerollTicket = { id: string; grade: 'NORMAL' | 'BRONZE' | 'SILVER' | 'GOLD'; status: 'UNUSED' | 'USED'; acquiredAt: string };
export type CoinRerollOption = { poolId: string; merchantId: string; merchantName: string; eventName: string;
  grade: CoinRerollTicket['grade']; entries: (CoinReference & { name: string; weight: number; probability: number })[] };
export type CoinReroll = { tickets: CoinRerollTicket[]; sources: CoinSource[]; options: CoinRerollOption[] };
export type CoinSeriesSlot = CoinReference & { name: string; quantity: number };
export type CoinSeries = {
  id: string; title: string; merchantId: string; merchantName: string; endsAt: string;
  base: { slots: CoinSeriesSlot[]; complete: boolean; title: string; detail: string };
  prism: { slots: CoinSeriesSlot[]; complete: boolean; title: string; detail: string };
  claimable: 'BASE' | 'PRISM' | null;
  coupon: { id: string; tier: 'BASE' | 'PRISM'; title: string; detail: string; expiresAt: string; status: 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'REVOKED'; redeemedAt: string | null } | null;
};
export type CoinShop = { mileage: { earned: number; spent: number; balance: number }; pools: CoinPool[]; tickets: CoinTicket[] };
export type CoinCollection = { coins: CoinOwned[]; series: CoinSeries[]; catalog: CoinCatalog; reroll: CoinReroll };
export type PurchasedCoinTicket = { ticket: CoinTicket; balance: number; replayed: boolean };
export type UsedCoinTicket = { ticket: CoinTicket; coin: CoinOwned; replayed: boolean };
export type ClaimedCoinSeries = { series: CoinSeries; replayed: boolean };
export type UsedCoinReroll = { rerollId: string; ticket: CoinRerollTicket; spent: CoinSource;
  coin: CoinOwned; replayed: boolean };

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
  getOwnedCoinDetail(accountId: string, publicationId: string, gradeId: string): Promise<CollectibleDetail>;
  claimSeries(input: { accountId: string; seriesId: string }): Promise<ClaimedCoinSeries>;
  publishPool(input: PublishCoinPoolInput): Promise<CoinPool>;
  publishSeries(input: PublishCoinSeriesInput): Promise<CoinSeries>;
  pausePool(input: { actorAccountId: string; poolId: string }): Promise<CoinPool>;
  grantTicket(input: { actorAccountId: string; accountId: string; poolId: string; requestId: string }): Promise<PurchasedCoinTicket>;
  grantRerollTicket(input: { actorAccountId: string; accountId: string; grade: CoinRerollTicket['grade']; requestId: string }): Promise<{ ticket: CoinRerollTicket; replayed: boolean }>;
  useRerollTicket(input: { accountId: string; ticketId: string; poolId: string; sourceKind: CoinSourceKind; sourceId: string; requestId: string }): Promise<UsedCoinReroll>;
}

export type CoinEconomyErrorCode =
  | 'INVALID_REQUEST' | 'ACCOUNT_DELETED' | 'COIN_POOL_UNAVAILABLE' | 'COIN_POOL_EXPIRED'
  | 'COIN_POOL_LIMIT_REACHED' | 'COIN_INSUFFICIENT_MILEAGE' | 'COIN_REQUEST_CONFLICT'
  | 'COIN_TICKET_NOT_FOUND' | 'COIN_TICKET_EXPIRED' | 'COIN_SERIES_UNAVAILABLE'
  | 'COIN_REROLL_TICKET_NOT_FOUND' | 'COIN_REROLL_TICKET_USED' | 'COIN_REROLL_SOURCE_NOT_FOUND'
  | 'COIN_REROLL_SOURCE_LOCKED' | 'COIN_REROLL_POOL_UNAVAILABLE' | 'COIN_REROLL_NO_CANDIDATES'
  | 'COIN_REROLL_RESULT_REVOKED' | 'COIN_OWNED_DETAIL_NOT_FOUND'
  | 'COIN_SERIES_INCOMPLETE' | 'COIN_SERIES_CAP_REACHED' | 'COIN_PUBLICATION_UNAVAILABLE';

export class CoinEconomyError extends Error {
  constructor(readonly code: CoinEconomyErrorCode) { super(code); this.name = 'CoinEconomyError'; }
}
