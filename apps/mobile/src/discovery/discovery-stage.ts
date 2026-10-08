import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { CoinShop } from '@/shop/coin-api';
import type { ShopSnapshot } from '@/shop/shop-api';

/**
 * Progressive disclosure (Issue #412): which entry points a person sees depends on how far they have come. Nothing is removed and
 * no balance changes: routes stay deep-linkable and Settings lists everything. Only the doors on Home, the header and 도감 open
 * later. This file is pure; the provider (discovery-provider.tsx) feeds it from the API.
 */

/** first-coin: no coin yet · after-first: has a coin · regular: has used the app across stores/draws. */
export type DiscoveryStage = 'first-coin' | 'after-first' | 'regular';

/** Entry points that only the person can turn on: friends/mail and the play entry cards. Never auto-promoted by progress. */
export type DiscoveryOptIn = { social: boolean; play: boolean };

/**
 * What the person has chosen so far. `social` stays undefined until they choose (Settings, or adding a friend): an account that
 * already has friends keeps the friends/mail doors without having to find the switch (see resolveOptIn).
 */
export type ChosenOptIn = { social?: boolean; play: boolean };

export type DiscoveryInput = {
  /** Owned collectibles (GET /collection). */
  collectibles: number;
  /** Visits the server counted toward progress. */
  countedVisits: number;
  distinctStores: number;
  /**
   * Earned badge tiers when a badge book is at hand. Optional: the tiers come from counted visits (explorer 1/2/3, regular 2/3/5,
   * steady 2/4/7), so the visit signals below already cover it and the provider spends no request on it.
   */
  badgeTiers?: number;
  /** Mileage the person earned, without any showcase bonus. */
  mileageBalance: number;
  /** An unused ticket in hand. Open pools alone say nothing about this person: every account sees the same ones. */
  hasPoolOrTicket: boolean;
  optedIn: DiscoveryOptIn;
  /** The QA switch (and the planned showcase "수집과 꾸미기 둘러보기" trial mode) forces everything visible. */
  forceRegular?: boolean;
};

export type Disclosure = { stage: DiscoveryStage; optIn: DiscoveryOptIn };

/** A Silver draw is affordable from here, so the shop is worth a door of its own. */
export const REGULAR_MILEAGE = 200;
export const REGULAR_VISITS = 3;
export const REGULAR_STORES = 2;
export const REGULAR_BADGE_TIERS = 3;

export const noOptIn: DiscoveryOptIn = { social: false, play: false };

/**
 * The opt-in the screens use. The person's own choice always wins; before they have chosen, friends/mail are implicitly on when the
 * account already has friends. Play is never implied. Having no friends yet implies nothing, so a newcomer sees neither door.
 */
export const resolveOptIn = (chosen: ChosenOptIn, friendCount: number | undefined): DiscoveryOptIn =>
  ({ social: chosen.social ?? (friendCount ?? 0) > 0, play: chosen.play === true });
const allOptIn: DiscoveryOptIn = { social: true, play: true };
const order: Record<DiscoveryStage, number> = { 'first-coin': 0, 'after-first': 1, regular: 2 };

export const atLeast = (stage: DiscoveryStage, minimum: DiscoveryStage): boolean => order[stage] >= order[minimum];
export const furtherStage = (a: DiscoveryStage, b: DiscoveryStage): DiscoveryStage => order[a] >= order[b] ? a : b;

export function discoveryStage(input: DiscoveryInput): Disclosure {
  if (input.forceRegular) return { stage: 'regular', optIn: allOptIn };
  const optIn = { social: input.optedIn.social === true, play: input.optedIn.play === true };
  const regular = input.distinctStores >= REGULAR_STORES || input.countedVisits >= REGULAR_VISITS
    || (input.badgeTiers ?? 0) >= REGULAR_BADGE_TIERS || input.mileageBalance >= REGULAR_MILEAGE || input.hasPoolOrTicket;
  if (regular) return { stage: 'regular', optIn };
  // A counted visit with no coin yet (a reward that comes at the next visit) is already past the first-coin offer.
  const started = input.collectibles >= 1 || input.countedVisits >= 1 || input.distinctStores >= 1;
  return { stage: started ? 'after-first' : 'first-coin', optIn };
}

/**
 * What the stage needs, read from the answers the app already has. Missing answers count as nothing yet (the stage never goes
 * down, see disclosure-record.ts). Mileage excludes the showcase bonus: a trial balance says nothing about how far someone came.
 */
export function stageInputs(source: {
  collection?: CollectionSnapshot; coinShop?: CoinShop; shop?: ShopSnapshot; optedIn: DiscoveryOptIn; now: number; forceRegular?: boolean;
}): DiscoveryInput {
  const counted = source.collection?.visits.filter((visit) => visit.progressCounted) ?? [];
  return {
    collectibles: source.collection?.collectibles.length ?? 0,
    countedVisits: counted.length,
    distinctStores: new Set(counted.map((visit) => visit.merchantId)).size,
    mileageBalance: source.shop ? Math.max(0, source.shop.mileage.balance - (source.shop.mileage.showcaseBonus ?? 0)) : 0,
    hasPoolOrTicket: source.coinShop?.tickets.some((ticket) => ticket.status === 'UNUSED' && Date.parse(ticket.expiresAt) > source.now) ?? false,
    optedIn: source.optedIn,
    ...(source.forceRegular ? { forceRegular: true } : {}),
  };
}

/** The server's cheapest draw price, so the shop card never repeats a number the server owns. */
export const cheapestDrawPrice = (shop: ShopSnapshot | undefined): number | undefined =>
  shop && shop.grades.length ? Math.min(...shop.grades.map((grade) => grade.price)) : undefined;

/** The shop card on Home: right after the first coin, once the person can afford a draw. The price is the server's, not ours. */
export const shopEntryVisible = (stage: DiscoveryStage, mileage: number, cheapestDraw: number | undefined): boolean =>
  stage === 'after-first' && cheapestDraw !== undefined && mileage >= cheapestDraw;

/** The mail icon in the header: unread mail is never hidden, otherwise it is part of the friends/mail opt-in. */
export const mailEntryVisible = (optIn: DiscoveryOptIn, unread: number | undefined): boolean => optIn.social || (unread ?? 0) > 0;

/** `EXPO_PUBLIC_DISCLOSURE=full` is the QA switch; CI leaves it unset. */
export const forcedByEnv = (value: string | undefined): boolean => value === 'full';
