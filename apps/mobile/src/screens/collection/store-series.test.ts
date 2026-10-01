import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildStoreSeries, seriesSlotText } from './store-series';

const merchant = {
  id: 'merchant-1', name: '월계 밥상',
  campaign: {
    id: 'campaign-1', title: '가을 도감', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-31T23:59:59Z',
    enrollmentStatus: 'OPEN' as const,
    rewardGoals: [
      { targetVisitCount: 5 as const, displayName: '다섯 번째 잎새' },
      { targetVisitCount: 1 as const, displayName: '첫 잎새' },
      { targetVisitCount: 3 as const, displayName: '세 번째 잎새' },
    ],
  },
};

test('merchants without reward goals produce no series', () => {
  const noGoals = { id: 'merchant-2', name: '목표 없는 가게', campaign: { ...merchant.campaign, id: 'c2', rewardGoals: [] } };
  assert.deepEqual(buildStoreSeries([noGoals], []), []);
});

test('slots are ordered by target visit count and marked owned from collected entitlements only', () => {
  const [series] = buildStoreSeries([merchant], [
    { entitlementId: 'e1', merchantId: 'merchant-1', campaignId: 'campaign-1', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' },
  ]);

  assert.equal(series!.merchantId, 'merchant-1');
  assert.deepEqual(series!.slots.map((slot) => slot.targetVisitCount), [1, 3, 5]);
  assert.equal(series!.slots[0]!.owned, true);
  assert.equal(series!.slots[0]!.entitlementId, 'e1');
  assert.equal(series!.slots[1]!.owned, false);
  assert.equal(series!.completed, false);
  assert.equal(series!.nextSlot!.targetVisitCount, 3);
});

test('a series with every goal collected is completed and has no next slot', () => {
  const collectibles = [1, 3, 5].map((targetVisitCount) => ({
    entitlementId: `e${targetVisitCount}`, merchantId: 'merchant-1', campaignId: 'campaign-1',
    targetVisitCount: targetVisitCount as 1 | 3 | 5, appCollectibleStatus: 'COLLECTED' as const,
  }));
  const [series] = buildStoreSeries([merchant], collectibles);
  assert.equal(series!.completed, true);
  assert.equal(series!.nextSlot, null);
});

test('an entitlement from a different campaign cycle never fills a slot', () => {
  const [series] = buildStoreSeries([merchant], [
    { entitlementId: 'old', merchantId: 'merchant-1', campaignId: 'campaign-0', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' },
  ]);
  assert.equal(series!.slots[0]!.owned, false);
});

test('seriesSlotText names the goal when owned and the visit target when not', () => {
  assert.equal(seriesSlotText({ targetVisitCount: 1, displayName: '첫 잎새', owned: true }), '1회 · 첫 잎새');
  assert.equal(seriesSlotText({ targetVisitCount: 3, displayName: '세 번째 잎새', owned: false }), '3회 방문하면 받아요');
});
