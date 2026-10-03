import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Recommendation } from '@/recommendation/recommendation-api';
import { afterVisitAction, hasOpenableBox } from './after-visit-action';

const suggestion: Recommendation = {
  merchantId: 'm2', merchantName: '동네 빵집', roadAddress: '월계로 1', campaignId: 'c2', campaignTitle: '빵집 산책',
  enrollmentStatus: 'OPEN', progressVisitCount: 2, demo: false, reasonCode: 'NEXT_REWARD',
  reasonText: '실버가 가까워요', nextGoal: { targetVisitCount: 3, displayName: '실버', remainingVisits: 1 },
};

test('새 수집품, 상자, 다음 가게, 도감 순서로 하나의 행동을 고른다', () => {
  assert.equal(afterVisitAction({ hasUnopenedCollectible: true, hasOpenableBox: true, nextSuggestion: suggestion }).kind, 'collectible');
  assert.equal(afterVisitAction({ hasUnopenedCollectible: false, hasOpenableBox: true, nextSuggestion: suggestion }).kind, 'box');
  assert.deepEqual(afterVisitAction({ hasUnopenedCollectible: false, hasOpenableBox: false, nextSuggestion: suggestion }), {
    kind: 'recommendation', label: '다음 가볼 곳: 동네 빵집', detail: '실버가 가까워요 · 실버까지 1번', merchantId: 'm2',
  });
  assert.deepEqual(afterVisitAction({ hasUnopenedCollectible: false, hasOpenableBox: false }), { kind: 'collection', label: '도감 보기' });
});

test('도감에서 마지막 상자를 열고 돌아오면 추천이 다음 행동이 된다', () => {
  const reward = { milestone: 1 as const, requiredTiers: 1, state: 'READY' as const, offer: null, coupon: null };
  assert.equal(afterVisitAction({ hasUnopenedCollectible: false, hasOpenableBox: hasOpenableBox({ rewards: [reward] }), nextSuggestion: suggestion }).kind, 'box');
  const opened = { ...reward, state: 'OPENED' as const };
  assert.equal(afterVisitAction({ hasUnopenedCollectible: false, hasOpenableBox: hasOpenableBox({ rewards: [opened] }), nextSuggestion: suggestion }).kind, 'recommendation');
});
