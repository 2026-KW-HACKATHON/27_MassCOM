import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { Recommendation } from '@/recommendation/recommendation-api';
import { homeErrorText, markHomePending, needsFirstStoreRecommendation, pickFirstStore, settleHomeSection, startHomeLoad, type HomeData } from './home-load';

const noVisits = { visits: [], collectibles: [] } as unknown as CollectionSnapshot;
const oneVisit = { visits: [{ visitEventId: 'v' }], collectibles: [] } as unknown as CollectionSnapshot;
const recommendation = (patch: Partial<Recommendation> = {}): Recommendation => ({
  merchantId: 'r', merchantName: '추천 가게', roadAddress: '도로', campaignId: 'c', campaignTitle: '캠페인', enrollmentStatus: 'OPEN',
  progressVisitCount: 0, demo: false, reasonCode: 'NEW_PLACE', reasonText: '아직 방문하지 않은 동네 가게예요.', ...patch,
});

test('a first load waits on the five requests and each one settles alone', () => {
  let data = startHomeLoad(undefined, 100);
  assert.deepEqual(data.pending, ['studio', 'coins', 'rewards', 'collection', 'merchants']);
  data = settleHomeSection(data, 'collection', { ok: true, value: noVisits });
  assert.equal(data.collection, noVisits, 'the CTA data is usable while the others are still loading');
  assert.deepEqual(data.pending, ['studio', 'coins', 'rewards', 'merchants']);
  data = settleHomeSection(data, 'coins', { ok: false });
  assert.deepEqual(data.errors, ['coins']);
  assert.equal(data.coinShop, undefined);
  assert.deepEqual(data.pending, ['studio', 'rewards', 'merchants']);
  data = settleHomeSection(data, 'rewards', { ok: true, value: 0 });
  assert.equal(data.rewardCount, 0, 'a zero count is a value, not "missing"');
});

test('a refresh keeps what is on screen, clears old errors and only re-waits for sections that never answered', () => {
  let data = startHomeLoad(undefined, 100);
  data = settleHomeSection(data, 'collection', { ok: true, value: oneVisit });
  data = settleHomeSection(data, 'rewards', { ok: true, value: 0 });
  data = settleHomeSection(data, 'studio', { ok: false });
  const again = startHomeLoad(data, 200);
  assert.equal(again.loadedAt, 200);
  assert.equal(again.collection, oneVisit);
  assert.deepEqual(again.errors, []);
  assert.deepEqual(again.pending, ['studio', 'coins', 'merchants']);
});

test('a failed refresh keeps the older value and reports the failure', () => {
  const data = settleHomeSection(settleHomeSection(startHomeLoad(undefined, 1), 'collection', { ok: true, value: oneVisit }), 'collection', { ok: false });
  assert.equal(data.collection, oneVisit);
  assert.deepEqual(data.errors, ['collection']);
  assert.equal(homeErrorText(data.errors), '도감 조회 실패 · 다시 시도');
  assert.equal(homeErrorText([]), null);
  assert.equal(homeErrorText(['recommendations']), null, 'the catalog store stands in, so this failure is silent');
  assert.equal(homeErrorText(['studio', 'recommendations', 'coins']), '마이룸·뽑기권 조회 실패 · 다시 시도');
});

test('a failure is never reported for a section that is not on screen', () => {
  // Before the first coin the room is closed; with no ticket in hand 보유 뽑기권 is not drawn either.
  assert.equal(homeErrorText(['studio', 'coins'], ['studio', 'coins']), null);
  assert.equal(homeErrorText(['studio', 'collection'], ['studio']), '도감 조회 실패 · 다시 시도', 'the visible failure is still named, without the hidden room');
  assert.equal(homeErrorText(['studio', 'coins'], ['studio']), '뽑기권 조회 실패 · 다시 시도');
  assert.equal(homeErrorText(['studio', 'coins'], []), '마이룸·뽑기권 조회 실패 · 다시 시도', 'everything shown: everything named');
});

test('the first store is highlighted only for someone with no visit, from the server recommendation first', () => {
  const goal = { merchantId: 'g', name: '카탈로그 가게' };
  const settled = (collection: CollectionSnapshot, recommendations?: readonly Recommendation[]): HomeData => {
    let data = settleHomeSection(startHomeLoad(undefined, 1), 'collection', { ok: true, value: collection });
    data = markHomePending(data, 'recommendations');
    return recommendations ? settleHomeSection(data, 'recommendations', { ok: true, value: recommendations }) : settleHomeSection(data, 'recommendations', { ok: false });
  };
  assert.equal(pickFirstStore(settled(oneVisit, [recommendation()]), goal), null, 'returning visitors get no first-store card');
  assert.deepEqual(pickFirstStore(settled(noVisits, [recommendation({ merchantId: 'x', reasonCode: 'NEXT_REWARD' }), recommendation()]), goal),
    { merchantId: 'r', name: '추천 가게', reason: '아직 방문하지 않은 동네 가게예요.', source: 'recommendation' });
  assert.equal(pickFirstStore(settled(noVisits), goal)?.source, 'catalog', 'recommendation failed: fall back to the catalog store');
  assert.equal(pickFirstStore(settled(noVisits), goal)?.reason, '참여 중인 캠페인이 있는 가게예요.', 'the fallback does not promise "지금"');
  assert.equal(pickFirstStore(settled(noVisits, []), null), null, 'nothing to recommend: no card');
});

test('no store is picked while the recommendation is still loading, and not before the collection answers', () => {
  const goal = { merchantId: 'g', name: '카탈로그 가게' };
  const waiting = markHomePending(settleHomeSection(startHomeLoad(undefined, 1), 'collection', { ok: true, value: noVisits }), 'recommendations');
  assert.equal(pickFirstStore(waiting, goal), null);
  assert.equal(pickFirstStore(startHomeLoad(undefined, 1), goal), null);
  assert.equal(pickFirstStore(undefined, goal), null);
});

test('the recommendation is requested once: not for visitors, and not again when the screen is revisited with one already shown', () => {
  assert.equal(needsFirstStoreRecommendation(0, false), true);
  assert.equal(needsFirstStoreRecommendation(0, true), false, 'a refocus keeps the store on show');
  assert.equal(needsFirstStoreRecommendation(2, false), false);
  // A refresh keeps a loaded recommendation and never re-marks it pending, so the card does not flicker.
  const shown = settleHomeSection(markHomePending(settleHomeSection(startHomeLoad(undefined, 1), 'collection', { ok: true, value: noVisits }), 'recommendations'), 'recommendations', { ok: true, value: [recommendation()] });
  const again = startHomeLoad(shown, 2);
  assert.equal(again.recommendations?.[0]?.merchantId, 'r');
  assert.equal(again.pending.includes('recommendations'), false);
  assert.equal(pickFirstStore(again, null)?.name, '추천 가게');
});
