import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { CoinShop } from '@/shop/coin-api';
import type { ShopSnapshot } from '@/shop/shop-api';
import {
  atLeast, cheapestDrawPrice, discoveryStage, forcedByEnv, furtherStage, mailEntryVisible, noOptIn, resolveOptIn, shopEntryVisible, stageInputs,
  type DiscoveryInput,
} from './discovery-stage';

const fresh: DiscoveryInput = { collectibles: 0, countedVisits: 0, distinctStores: 0, mileageBalance: 0, hasPoolOrTicket: false, optedIn: noOptIn };
const stageOf = (patch: Partial<DiscoveryInput>) => discoveryStage({ ...fresh, ...patch }).stage;

test('someone with nothing yet is at the first-coin stage', () => {
  assert.deepEqual(discoveryStage(fresh), { stage: 'first-coin', optIn: { social: false, play: false } });
});

test('the first coin, or the first counted visit, moves to after-first', () => {
  assert.equal(stageOf({ collectibles: 1 }), 'after-first');
  assert.equal(stageOf({ countedVisits: 1, distinctStores: 1 }), 'after-first');
  // A counted visit whose coin has not arrived yet is already past the first-coin offer.
  assert.equal(stageOf({ countedVisits: 1 }), 'after-first');
  assert.equal(stageOf({ collectibles: 1, countedVisits: 1, distinctStores: 1, mileageBalance: 150 }), 'after-first');
});

test('each regular trigger alone is enough, and one short of it is not', () => {
  const started = { collectibles: 1, countedVisits: 1, distinctStores: 1 };
  assert.equal(stageOf({ ...started, distinctStores: 2 }), 'regular', 'second store');
  assert.equal(stageOf({ ...started, countedVisits: 3 }), 'regular', 'three counted visits');
  assert.equal(stageOf({ ...started, countedVisits: 2 }), 'after-first');
  assert.equal(stageOf({ ...started, badgeTiers: 3 }), 'regular', 'three badge tiers');
  assert.equal(stageOf({ ...started, badgeTiers: 2 }), 'after-first');
  assert.equal(stageOf({ ...started, mileageBalance: 200 }), 'regular', 'a Silver draw is affordable');
  assert.equal(stageOf({ ...started, mileageBalance: 199 }), 'after-first');
  assert.equal(stageOf({ ...started, hasPoolOrTicket: true }), 'regular', 'a ticket in hand');
});

test('the first-visit mileage (150) alone does not open the regular stage', () => {
  assert.equal(stageOf({ collectibles: 1, countedVisits: 1, distinctStores: 1, mileageBalance: 150 }), 'after-first');
});

test('regular signals win even without a collectible (a ticket bought with earned mileage)', () => {
  assert.equal(stageOf({ hasPoolOrTicket: true }), 'regular');
  assert.equal(stageOf({ distinctStores: 2 }), 'regular');
});

test('badge tiers are optional: leaving them out changes nothing', () => {
  assert.equal(stageOf({ collectibles: 1 }), discoveryStage({ ...fresh, collectibles: 1, badgeTiers: 0 }).stage);
});

test('opt-in is carried through as the person chose it and never raised by progress', () => {
  const regular = { ...fresh, collectibles: 5, countedVisits: 9, distinctStores: 4, mileageBalance: 900, hasPoolOrTicket: true };
  assert.deepEqual(discoveryStage(regular).optIn, { social: false, play: false });
  assert.deepEqual(discoveryStage({ ...regular, optedIn: { social: true, play: false } }).optIn, { social: true, play: false });
  assert.deepEqual(discoveryStage({ ...fresh, optedIn: { social: false, play: true } }), { stage: 'first-coin', optIn: { social: false, play: true } });
});

test('only a real true counts as opted in', () => {
  const sloppy = { social: 'yes', play: 1 } as unknown as DiscoveryInput['optedIn'];
  assert.deepEqual(discoveryStage({ ...fresh, optedIn: sloppy }).optIn, { social: false, play: false });
});

test('an account that already has friends keeps friends and mail until the person chooses; a choice always wins', () => {
  assert.deepEqual(resolveOptIn({ play: false }, 3), { social: true, play: false }, 'existing social users keep their doors');
  assert.deepEqual(resolveOptIn({ play: false }, 0), { social: false, play: false }, 'no friends and no choice: closed');
  assert.deepEqual(resolveOptIn({ play: false }, undefined), { social: false, play: false }, 'friend count unknown yet: closed');
  assert.deepEqual(resolveOptIn({ social: false, play: false }, 3), { social: false, play: false }, 'turned off in Settings stays off');
  assert.deepEqual(resolveOptIn({ social: true, play: false }, 0), { social: true, play: false }, 'added a friend, then removed them: still on');
  assert.deepEqual(resolveOptIn({ play: true }, 5), { social: true, play: true });
  assert.equal(resolveOptIn({ play: undefined as never }, 5).play, false, 'play is never implied by friends');
  // The resolved choice feeds the stage unchanged.
  assert.deepEqual(discoveryStage({ ...fresh, optedIn: resolveOptIn({ play: false }, 2) }), { stage: 'first-coin', optIn: { social: true, play: false } });
});

test('forceRegular opens everything, opt-in included, whatever the progress', () => {
  assert.deepEqual(discoveryStage({ ...fresh, forceRegular: true }), { stage: 'regular', optIn: { social: true, play: true } });
  assert.deepEqual(discoveryStage({ ...fresh, forceRegular: false }).stage, 'first-coin');
});

test('stages order first-coin < after-first < regular', () => {
  assert.equal(atLeast('first-coin', 'after-first'), false);
  assert.equal(atLeast('after-first', 'after-first'), true);
  assert.equal(atLeast('regular', 'after-first'), true);
  assert.equal(atLeast('after-first', 'regular'), false);
  assert.equal(furtherStage('regular', 'after-first'), 'regular');
  assert.equal(furtherStage('first-coin', 'after-first'), 'after-first');
  assert.equal(furtherStage('after-first', 'after-first'), 'after-first');
});

test('the mail icon shows with unread mail or the social opt-in, otherwise it stays out of the header', () => {
  assert.equal(mailEntryVisible(noOptIn, 0), false);
  assert.equal(mailEntryVisible(noOptIn, undefined), false);
  assert.equal(mailEntryVisible(noOptIn, 2), true);
  assert.equal(mailEntryVisible({ social: true, play: false }, 0), true);
  assert.equal(mailEntryVisible({ social: false, play: true }, 0), false);
});

test('the shop card is for the stretch right after the first coin, once a draw is affordable', () => {
  assert.equal(shopEntryVisible('after-first', 150, 100), true);
  assert.equal(shopEntryVisible('after-first', 100, 100), true);
  assert.equal(shopEntryVisible('after-first', 99, 100), false);
  assert.equal(shopEntryVisible('first-coin', 500, 100), false);
  assert.equal(shopEntryVisible('regular', 500, 100), false);
  assert.equal(shopEntryVisible('after-first', 500, undefined), false, 'no server price yet');
});

test('QA switch: only the exact value "full" forces disclosure', () => {
  assert.equal(forcedByEnv('full'), true);
  for (const value of [undefined, '', 'FULL', 'true', '1', 'regular']) assert.equal(forcedByEnv(value), false, String(value));
});

// --- reading the stage inputs from what the app already has ---

const visit = (merchantId: string, progressCounted: boolean) => ({
  visitEventId: `${merchantId}-${progressCounted}`, merchantId, merchantName: merchantId, campaignId: 'c', campaignTitle: 't',
  businessDate: '2026-10-01', progressCounted, verificationLevel: 'MERCHANT_CONFIRMED' as const,
});
const collection = (visits: ReturnType<typeof visit>[], collectibles = 0) =>
  ({ visits, collectibles: Array.from({ length: collectibles }, () => ({})) }) as unknown as CollectionSnapshot;
const shopWith = (balance: number, showcaseBonus?: number, prices: number[] = [100, 200, 400]) => ({
  mileage: { earned: balance, spent: 0, balance, ...(showcaseBonus ? { showcaseBonus } : {}), rules: { visit: 50, newStore: 100, series: 200 } },
  grades: prices.map((price) => ({ grade: 'BRONZE', price })),
}) as unknown as ShopSnapshot;
const coinShopWith = (...tickets: { status: 'UNUSED' | 'USED' | 'EXPIRED'; expiresAt: string }[]) => ({ mileage: { earned: 0, spent: 0, balance: 0 }, pools: [], tickets }) as unknown as CoinShop;
const NOW = Date.parse('2026-10-08T00:00:00Z');

test('inputs count only visits the server counted, and distinct stores among them', () => {
  const inputs = stageInputs({ collection: collection([visit('a', true), visit('a', true), visit('b', false)], 2), optedIn: noOptIn, now: NOW });
  assert.equal(inputs.collectibles, 2);
  assert.equal(inputs.countedVisits, 2);
  assert.equal(inputs.distinctStores, 1);
  assert.equal(discoveryStage(inputs).stage, 'after-first');
});

test('inputs treat missing answers as nothing yet', () => {
  const inputs = stageInputs({ optedIn: noOptIn, now: NOW });
  assert.deepEqual(inputs, fresh);
});

test('a showcase bonus never counts as progress, but real mileage does', () => {
  assert.equal(stageInputs({ shop: shopWith(100_150, 100_000), optedIn: noOptIn, now: NOW }).mileageBalance, 150);
  assert.equal(stageInputs({ shop: shopWith(250), optedIn: noOptIn, now: NOW }).mileageBalance, 250);
  assert.equal(stageInputs({ shop: shopWith(50, 100_000), optedIn: noOptIn, now: NOW }).mileageBalance, 0, 'spent below the bonus never goes negative');
});

test('only an unused, unexpired ticket counts; open pools say nothing about this person', () => {
  const later = '2026-10-20T00:00:00Z';
  const earlier = '2026-10-01T00:00:00Z';
  assert.equal(stageInputs({ coinShop: coinShopWith({ status: 'UNUSED', expiresAt: later }), optedIn: noOptIn, now: NOW }).hasPoolOrTicket, true);
  assert.equal(stageInputs({ coinShop: coinShopWith({ status: 'UNUSED', expiresAt: earlier }), optedIn: noOptIn, now: NOW }).hasPoolOrTicket, false);
  assert.equal(stageInputs({ coinShop: coinShopWith({ status: 'USED', expiresAt: later }), optedIn: noOptIn, now: NOW }).hasPoolOrTicket, false);
  const withPool = { ...coinShopWith(), pools: [{ id: 'p', status: 'ACTIVE' }] } as unknown as CoinShop;
  assert.equal(stageInputs({ coinShop: withPool, optedIn: noOptIn, now: NOW }).hasPoolOrTicket, false);
});

test('inputs pass the override and the opt-in through untouched', () => {
  const optedIn = { social: true, play: false };
  assert.deepEqual(stageInputs({ optedIn, now: NOW }).optedIn, optedIn);
  assert.equal(stageInputs({ optedIn, now: NOW }).forceRegular, undefined);
  assert.equal(stageInputs({ optedIn, now: NOW, forceRegular: true }).forceRegular, true);
});

test('the cheapest draw price is the server\'s lowest grade price', () => {
  assert.equal(cheapestDrawPrice(shopWith(0, undefined, [400, 100, 200])), 100);
  assert.equal(cheapestDrawPrice(shopWith(0, undefined, [])), undefined);
  assert.equal(cheapestDrawPrice(undefined), undefined);
});
