import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BadgeBook, Coupon } from '../../gamification/badge-api';
import type { PublicMerchant } from '../../merchant/merchant-api';
import {
  buildFilterContext,
  categoryChipOptions,
  couponMerchantIds,
  describeActiveFilters,
  emptyFilterCopy,
  keepAvailableFilters,
  progressChipLabel,
  progressChipOptions,
  toggleProgress,
} from './discovery-filters';

const goals = [
  { targetVisitCount: 1, displayName: '첫 방문' }, { targetVisitCount: 3, displayName: '단골' }, { targetVisitCount: 5, displayName: '관' },
] as const;
function merchant(id: string, category: PublicMerchant['category'] = null): PublicMerchant {
  return {
    id, name: `가게 ${id}`, story: '', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 5_000, menuItems: [], businessHours: '',
    category, demo: false, artUrl: null,
    campaign: { id: `c-${id}`, title: '가을', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z', enrollmentStatus: 'OPEN', rewardGoals: goals },
  };
}

test('category chips list only the categories in the loaded list, in the fixed category order, once each', () => {
  assert.deepEqual(categoryChipOptions([merchant('a', '카페'), merchant('b', '한식'), merchant('c', '카페'), merchant('d')]), ['한식', '카페']);
  assert.deepEqual(categoryChipOptions([merchant('a'), merchant('b')]), [], 'a list with no category has nothing to choose');
  assert.deepEqual(categoryChipOptions([]), []);
});

test('progress chips appear only for a signed-in account whose data has loaded, in the fixed order', () => {
  assert.deepEqual(progressChipOptions({ signedIn: false, collectionReady: true, badgesReady: true }), []);
  assert.deepEqual(progressChipOptions({ signedIn: true, collectionReady: false, badgesReady: false }), []);
  assert.deepEqual(progressChipOptions({ signedIn: true, collectionReady: true, badgesReady: true }), ['oneLeft', 'unvisited', 'visited', 'coupon']);
  // Each chip needs its own data: no coupon chip over a badge book that did not load, no visit chips over a collection that did not.
  assert.deepEqual(progressChipOptions({ signedIn: true, collectionReady: true, badgesReady: false }), ['oneLeft', 'unvisited', 'visited']);
  assert.deepEqual(progressChipOptions({ signedIn: true, collectionReady: false, badgesReady: true }), ['coupon']);
});

test('the chip labels are the Korean copy of the spec', () => {
  assert.deepEqual(
    (['oneLeft', 'unvisited', 'visited', 'coupon'] as const).map(progressChipLabel),
    ['보상까지 1번', '안 가 본 곳', '가 본 곳', '쿠폰 쓸 수 있는 곳'],
  );
});

test('tapping the chosen progress chip again turns it off, tapping another switches', () => {
  assert.equal(toggleProgress(null, 'visited'), 'visited');
  assert.equal(toggleProgress('visited', 'visited'), null);
  assert.equal(toggleProgress('visited', 'coupon'), 'coupon');
});

test('a chosen filter whose chip is gone (logged out, category left the list) falls back to all', () => {
  const chosen = { query: '김밥', category: '카페', progress: 'coupon' } as const;
  assert.deepEqual(keepAvailableFilters(chosen, { categories: ['카페'], progressOptions: ['coupon'] }), chosen);
  assert.deepEqual(keepAvailableFilters(chosen, { categories: ['한식'], progressOptions: ['coupon'] }), { query: '김밥', category: null, progress: 'coupon' });
  assert.deepEqual(keepAvailableFilters(chosen, { categories: ['카페'], progressOptions: [] }), { query: '김밥', category: '카페', progress: null });
  // The search text is never dropped.
  assert.equal(keepAvailableFilters(chosen, { categories: [], progressOptions: [] }).query, '김밥');
});

function coupon(merchantId: string, overrides: Partial<Coupon> = {}): Coupon {
  return {
    couponId: `coupon-${merchantId}`, milestone: 1, merchantId, merchantName: merchantId, title: '쿠폰', detail: '', status: 'ISSUED',
    issuedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-31T00:00:00.000Z', redeemedAt: null, ...overrides,
  };
}
function book(coupons: readonly (Coupon | null)[]): Pick<BadgeBook, 'rewards'> {
  return {
    rewards: coupons.map((entry, index) => ({
      milestone: (index + 1) as 1 | 2 | 3, requiredTiers: index + 1, state: entry ? 'OPENED' : 'LOCKED', offer: null, coupon: entry,
    })),
  };
}
const now = '2026-10-03T00:00:00.000Z';

test('only an unredeemed, unexpired coupon makes its merchant a coupon shop', () => {
  const held = book([
    coupon('open'),
    coupon('used', { status: 'REDEEMED', redeemedAt: '2026-10-02T00:00:00.000Z' }),
    coupon('expired-status', { status: 'EXPIRED' }),
  ]);
  assert.deepEqual([...couponMerchantIds(held, now)], ['open']);
  const more = book([coupon('voided', { status: 'VOIDED' }), coupon('late', { expiresAt: '2026-10-02T23:59:59.000Z' }), coupon('ok')]);
  assert.deepEqual([...couponMerchantIds(more, now)], ['ok'], 'a coupon past its expiry is not usable even if the server has not flipped its status yet');
  assert.deepEqual([...couponMerchantIds(book([null, null, null]), now)], []);
  assert.deepEqual([...couponMerchantIds(undefined, now)], []);
});

test('the context is built from the same goal, visit and coupon models the collection and passport use', () => {
  const merchants = [merchant('a'), merchant('b'), merchant('c')];
  const visit = (merchantId: string, progressCounted = true) => ({ merchantId, campaignId: `c-${merchantId}`, progressCounted });
  const context = buildFilterContext({
    merchants,
    collection: { visits: [visit('a'), visit('a'), visit('b', false)], collectibles: [] },
    book: book([coupon('c'), null, null]),
    now,
  });
  // a: 2 counted visits, goals 1/3/5 and nothing collected yet -> the next goal (1) is already reached -> 0 left (waiting to be recorded).
  assert.equal(context.goalsByMerchant.get('a')?.remainingVisits, 0);
  assert.equal(context.goalsByMerchant.get('b')?.remainingVisits, 1, 'a visit that did not count toward progress is still a visit row, but not progress');
  assert.equal(context.goalsByMerchant.get('c')?.remainingVisits, 1);
  assert.equal(context.goalsByMerchant.get('c')?.campaignStatus, 'open');
  assert.deepEqual([...context.visitedMerchantIds].sort(), ['a', 'b']);
  assert.deepEqual([...context.couponMerchantIds], ['c']);
});

test('without a collection or a badge book the context is empty rather than guessed', () => {
  const context = buildFilterContext({ merchants: [merchant('a')], collection: undefined, book: undefined, now });
  assert.equal(context.goalsByMerchant.size, 0);
  assert.equal(context.visitedMerchantIds.size, 0);
  assert.equal(context.couponMerchantIds.size, 0);
});

test('the active filters are named in the order search, category, progress', () => {
  assert.equal(describeActiveFilters({ query: '  김밥 ', category: '한식', progress: 'unvisited' }), '검색어 “김밥” · 한식 · 안 가 본 곳');
  assert.equal(describeActiveFilters({ query: '', category: '카페', progress: null }), '카페');
  assert.equal(describeActiveFilters({ query: '라면', category: null, progress: null }), '검색어 “라면”');
  assert.equal(describeActiveFilters({ query: ' ', category: null, progress: 'coupon' }), '쿠폰 쓸 수 있는 곳');
  assert.equal(describeActiveFilters({ query: '', category: null, progress: null }), '');
});

test('the empty result says which filters are on and offers 필터 지우기', () => {
  const copy = emptyFilterCopy({ query: '케이크', category: '카페', progress: 'oneLeft' });
  assert.equal(copy.title, '조건에 맞는 가게가 없어요');
  assert.match(copy.body, /검색어 “케이크” · 카페 · 보상까지 1번/);
  assert.equal(copy.actionLabel, '필터 지우기');
});
