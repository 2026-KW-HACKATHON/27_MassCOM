import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyMerchantFilters, hasActiveFilters, type MerchantFilterContext, type MerchantFilters } from './apply-merchant-filters';
import type { PublicMerchant } from './merchant-api';

function merchant(id: string, overrides: Partial<PublicMerchant> = {}): PublicMerchant {
  return {
    id, name: `가게 ${id}`, story: '', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 5_000, menuItems: [], businessHours: '',
    category: null, demo: false, artUrl: null, visitorTags: [],
    campaign: { id: `c-${id}`, title: '가을 방문 도감', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-31T00:00:00Z', enrollmentStatus: 'OPEN', rewardGoals: [] },
    ...overrides,
  };
}

// a: 한식, 김밥, 다음 목표까지 1번(가 봄) · b: 카페, 커피, 2번 · c: 카페, 케이크, 1번이지만 방문 전(첫 목표) · d: 분식 없음(업종 미지정), 보상 모두 받음 · e: 한식, 캠페인 종료 직전 1번
const a = merchant('a', { name: '월계 김밥집', story: '아침을 여는 집', category: '한식', menuItems: [{ name: '참치김밥', priceWon: 4500 }, { name: '라면', priceWon: 4000 }] });
const b = merchant('b', { name: '골목 카페', story: 'Coffee와 휴식', roadAddress: '서울 노원구 광운로 2', category: '카페', menuItems: [{ name: '아메리카노', priceWon: 3000 }] });
const c = merchant('c', { name: '달콤 베이커리', category: '카페', menuItems: [{ name: '딸기 케이크', priceWon: 6500 }], campaign: { ...merchant('c').campaign, title: '디저트 탐험' } });
const d = merchant('d', { name: '무명 식당', story: '업종을 아직 고르지 않았어요' });
const e = merchant('e', { name: '마감 임박 국수집', category: '한식', menuItems: [{ name: '잔치국수', priceWon: 6000 }] });
const all = [a, b, c, d, e] as const;
const ids = (list: readonly PublicMerchant[]) => list.map(({ id }) => id);

const none: MerchantFilters = { query: '', category: null, progress: null };
const context: MerchantFilterContext = {
  goalsByMerchant: new Map([
    ['a', { remainingVisits: 1, campaignStatus: 'open' }],
    ['b', { remainingVisits: 2, campaignStatus: 'open' }],
    ['c', { remainingVisits: 1, campaignStatus: 'open' }],
    ['d', { remainingVisits: null, campaignStatus: 'open' }],
    ['e', { remainingVisits: 1, campaignStatus: 'ended' }],
  ]),
  visitedMerchantIds: new Set(['a', 'b', 'd']),
  couponMerchantIds: new Set(['b', 'e']),
};

test('with no filter active the very same list comes back, in the API order', () => {
  assert.equal(applyMerchantFilters(all, none, context), all);
  assert.equal(applyMerchantFilters(all, { ...none, query: '  \t ' }, context), all);
  assert.equal(hasActiveFilters(none), false);
  assert.equal(hasActiveFilters({ ...none, query: '  ' }), false);
  assert.equal(hasActiveFilters({ ...none, query: '김' }), true);
  assert.equal(hasActiveFilters({ ...none, category: '카페' }), true);
  assert.equal(hasActiveFilters({ ...none, progress: 'coupon' }), true);
});

test('search matches name, story, address, campaign title and menu item names, trimmed and case-insensitive', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '  김밥  ' }, context)), ['a']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '아침' }, context)), ['a']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '광운로' }, context)), ['b']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: 'COFFEE' }, context)), ['b']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '디저트' }, context)), ['c']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '월계로' }, context)), ['a', 'c', 'd', 'e']);
});

test('menu names are searchable: a dish finds the shop that sells it, not the others (#331)', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '케이크' }, context)), ['c']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '라면' }, context)), ['a']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '국수' }, context)), ['e']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '아메리' }, context)), ['b']);
  // The price is not searchable text: only names are.
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, query: '4500' }, context)), []);
});

test('a category keeps only that category; null means all; an unset category matches no category chip', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, category: '한식' }, context)), ['a', 'e']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, category: '카페' }, context)), ['b', 'c']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, category: '일식' }, context)), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, category: null }, context)), ['a', 'b', 'c', 'd', 'e']);
});

test('oneLeft: a shop already visited whose next goal is exactly one visit away, by the same remainingVisits as the collection screen', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'oneLeft' }, context)), ['a']);
});

test('an unvisited shop is not oneLeft even though its first goal is one visit away, and it stays in unvisited', () => {
  // c has remainingVisits 1 (the first goal) but no visit row yet.
  assert.equal(context.goalsByMerchant.get('c')?.remainingVisits, 1);
  assert.equal(context.visitedMerchantIds.has('c'), false);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'oneLeft' }, context)).includes('c'), false);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'unvisited' }, context)).includes('c'), true);
  // Once it has a visit row (and still one to go) it becomes oneLeft.
  const visitedC: MerchantFilterContext = { ...context, visitedMerchantIds: new Set([...context.visitedMerchantIds, 'c']) };
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'oneLeft' }, visitedC)), ['a', 'c']);
});

test('oneLeft drops two-away, finished, ended-campaign and unknown shops', () => {
  const edge: MerchantFilterContext = {
    ...context,
    visitedMerchantIds: new Set(['a', 'b', 'c', 'd', 'e']),
    goalsByMerchant: new Map([
      ['a', { remainingVisits: 0, campaignStatus: 'open' }],
      ['b', { remainingVisits: 3, campaignStatus: 'open' }],
      ['c', { remainingVisits: 1, campaignStatus: 'upcoming' }],
      ['e', { remainingVisits: 1, campaignStatus: 'ended' }],
    ]),
  };
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'oneLeft' }, edge)), []);
});

test('unvisited and visited are exact opposites over the same visit rows', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'unvisited' }, context)), ['c', 'e']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'visited' }, context)), ['a', 'b', 'd']);
  const split = [...applyMerchantFilters(all, { ...none, progress: 'unvisited' }, context), ...applyMerchantFilters(all, { ...none, progress: 'visited' }, context)];
  assert.deepEqual(ids(split).sort(), ids(all).slice().sort());
});

test('coupon keeps only shops where the account holds an unredeemed coupon', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'coupon' }, context)), ['b', 'e']);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'coupon' }, { ...context, couponMerchantIds: new Set() })), []);
});

test('filters combine with AND and keep the API order', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '카페', category: '카페', progress: null }, context)), ['b']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '', category: '한식', progress: 'unvisited' }, context)), ['e']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '', category: '카페', progress: 'oneLeft' }, context)), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '', category: '한식', progress: 'oneLeft' }, context)), ['a']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '케이크', category: '카페', progress: 'unvisited' }, context)), ['c']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '케이크', category: '한식', progress: null }, context)), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '', category: '카페', progress: 'coupon' }, context)), ['b']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '월계', category: null, progress: 'visited' }, context)), ['a', 'd']);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '없는메뉴', category: '카페', progress: 'coupon' }, context)), []);
});

test('without account data (signed out) a progress filter finds no coupon or goal, and every shop reads as unvisited', () => {
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'coupon' })), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'oneLeft' })), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { ...none, progress: 'visited' })), []);
  assert.deepEqual(ids(applyMerchantFilters(all, { query: '김밥', category: null, progress: null })), ['a']);
});
