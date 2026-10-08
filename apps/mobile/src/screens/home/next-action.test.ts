import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoinPool, CoinTicket } from '@/shop/coin-api';
import { homeNextAction } from './next-action';
import type { HomeData } from './home-load';
import type { homeVisitGoal } from './visit-goal';

const loadedAt = Date.parse('2026-10-09T00:00:00Z');
const ticket: CoinTicket = { id: 'ticket-1', poolId: 'pool-1', merchantId: 'merchant-1', eventName: '가게 코인',
  grade: 'BRONZE', acquiredAt: '2026-10-08T00:00:00Z', expiresAt: '2026-10-10T00:00:00Z', status: 'UNUSED' };
const pool: CoinPool = { id: 'pool-1', merchantId: 'merchant-1', merchantName: '월계김밥', eventName: '가게 코인',
  grade: 'BRONZE', price: 0, purchaseStartsAt: '2026-10-01T00:00:00Z', purchaseEndsAt: '2026-10-31T00:00:00Z',
  useExpiresAt: '2026-10-31T00:00:00Z', perAccountLimit: 1, issuanceCap: 1, issuedCount: 1, status: 'ACTIVE', entries: [] };
const data = (change: Partial<HomeData> = {}): HomeData => ({ loadedAt, pending: [], errors: [], rewardCount: 0,
  coinShop: { tickets: [], pools: [pool], mileage: { earned: 0, spent: 0, balance: 0 } },
  collection: { visits: [], collectibles: [] }, merchants: [], ...change });
const goal: NonNullable<ReturnType<typeof homeVisitGoal>> = { merchantId: 'merchant-1', name: '월계김밥', count: 1, goals: [1, 3], next: 3 };

test('unopened visit reward outranks usable merchant coin tickets and first visit', () => {
  assert.equal(homeNextAction(data({ rewardCount: 2, coinShop: { ...data().coinShop!, tickets: [ticket] } }), null)?.kind, 'reward');
});

test('only a valid unused merchant coin ticket becomes the next action', () => {
  assert.equal(homeNextAction(data({ coinShop: { ...data().coinShop!, tickets: [ticket] } }), null)?.kind, 'coin-ticket');
  for (const invalid of [{ ...ticket, status: 'USED' as const }, { ...ticket, expiresAt: '2026-10-09T00:00:00Z' },
    { ...ticket, expiresAt: 'invalid' }]) {
    assert.equal(homeNextAction(data({ coinShop: { ...data().coinShop!, tickets: [invalid] } }), null)?.kind, 'first-visit');
  }
  assert.equal(homeNextAction(data({ coinShop: { ...data().coinShop!, pools: [], tickets: [ticket] } }), null)?.kind, 'first-visit');
  assert.equal(homeNextAction(data({ coinShop: { ...data().coinShop!, pools: [{ ...pool, unavailableReason: 'MEDIA_REMOVED' }], tickets: [ticket] } }), null)?.kind, 'first-visit');
  assert.equal(homeNextAction(data({ coinShop: { ...data().coinShop!, pools: [{ ...pool, unavailableReason: 'PUBLICATION_UNAVAILABLE' }], tickets: [ticket] } }), null)?.kind, 'coin-ticket');
});

test('unknown or failed higher priority sections never imply an empty result', () => {
  assert.equal(homeNextAction(undefined, null), null);
  assert.equal(homeNextAction(data({ rewardCount: undefined }), null), null);
  assert.equal(homeNextAction(data({ pending: ['rewards'], rewardCount: 2 }), null), null, 'old rewards cannot choose a new CTA');
  assert.equal(homeNextAction(data({ coinShop: undefined }), null), null);
  assert.equal(homeNextAction(data({ pending: ['coins'], coinShop: { ...data().coinShop!, tickets: [ticket] } }), null), null);
  assert.equal(homeNextAction(data({ errors: ['coins'] }), null), null);
  assert.equal(homeNextAction(data({ collection: undefined }), null), null);
  assert.equal(homeNextAction(data({ pending: ['collection'] }), null), null);
  assert.equal(homeNextAction(data({ errors: ['collection'] }), null), null);
});

test('server-confirmed acquisition appears after redeemable rights and before another visit', () => {
  const newCoin = homeNextAction(data({ acquiredSinceLastView: 'coin' }), goal);
  assert.equal(newCoin?.kind, 'new-coin');
  assert.equal(newCoin?.title, '새로 확인한 코인 보기');
  assert.equal(homeNextAction(data({ acquiredSinceLastView: 'collectible' }), goal)?.kind, 'new-collectible');
  assert.equal(homeNextAction(data({ acquiredSinceLastView: 'coin', rewardCount: 1 }), goal)?.kind, 'reward');
  assert.equal(homeNextAction(data({ acquiredSinceLastView: 'coin', coinShop: { ...data().coinShop!, tickets: [ticket] } }), goal)?.kind, 'coin-ticket');
  assert.equal(homeNextAction(data({ acquiredSinceLastView: 'collectible', pending: ['collection'] }), goal), null);
});

test('visiting users see progress to the next store visit, then the collection', () => {
  const visited = data({ collection: { visits: [{ visitEventId: 'visit-1', merchantId: 'merchant-1', merchantName: '월계김밥',
    campaignId: 'campaign-1', campaignTitle: '방문 캠페인', businessDate: '2026-10-08', progressCounted: true,
    verificationLevel: 'MERCHANT_CONFIRMED' }], collectibles: [] } });
  assert.deepEqual(homeNextAction(visited, goal), { kind: 'next-visit', title: '월계김밥 다시 방문하기',
    detail: '다음 방문 목표까지 2회', merchantId: 'merchant-1' });
  assert.equal(homeNextAction(visited, { ...goal, next: null })?.kind, 'collection');
  assert.equal(homeNextAction(visited, undefined), null);
  assert.match(homeNextAction(visited, { ...goal, merchantId: 'showcase-wolgye-demo' })?.title ?? '', /시연 · 참여하지 않은 가게/);
});
