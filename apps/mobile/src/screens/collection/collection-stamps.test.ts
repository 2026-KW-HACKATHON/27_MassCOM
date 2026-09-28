import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { buildMerchantGoals, buildStampSlots, describeMerchantGoal, stampColumnCount } from './collection-stamps';

const merchants: readonly Pick<PublicMerchant, 'id' | 'name'>[] = [
  { id: 'one', name: '가상 점포 A' },
  { id: 'two', name: '가상 점포 B' },
  { id: 'three', name: '가상 점포 C' },
];

const campaignMerchants: readonly Pick<PublicMerchant, 'id' | 'name' | 'campaign'>[] = [{
  id: 'one', name: '가상 점포 A', campaign: {
    id: 'current', title: '현재 캠페인', startsAt: '2026-09-01T00:00:00Z',
    endsAt: '2026-10-01T00:00:00Z', enrollmentStatus: 'OPEN',
    rewardGoals: [
      { targetVisitCount: 1, displayName: '첫 방문' },
      { targetVisitCount: 3, displayName: '세 번째 방문' },
    ],
  },
}];

test('reward progress counts only current campaign visits marked progressCounted', () => {
  const visits = [
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
    { merchantId: 'one', campaignId: 'current', progressCounted: false },
    { merchantId: 'one', campaignId: 'old', progressCounted: true },
  ];
  const slots = buildMerchantGoals(campaignMerchants, visits, [], '2026-09-28T00:00:00Z');
  assert.equal(slots[0]?.progressCount, 1);
  assert.deepEqual(slots[0]?.nextGoal, { targetVisitCount: 1, displayName: '첫 방문' });
  assert.equal(slots[0]?.remainingVisits, 0);
});

test('earned app collectible advances the next goal without implying NFT issuance', () => {
  const collectibles = [{
    merchantId: 'one', campaignId: 'current', targetVisitCount: 1,
    appCollectibleStatus: 'COLLECTED', nftStatus: 'NOT_REQUESTED',
  }] as const satisfies readonly Pick<CollectionSnapshot['collectibles'][number], 'merchantId' | 'campaignId' | 'targetVisitCount' | 'appCollectibleStatus' | 'nftStatus'>[];
  const slots = buildMerchantGoals(campaignMerchants, [
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
    { merchantId: 'one', campaignId: 'current', progressCounted: false },
  ], collectibles, '2026-09-28T00:00:00Z');
  assert.deepEqual(slots[0]?.earnedGoals, [1]);
  assert.deepEqual(slots[0]?.nextGoal, { targetVisitCount: 3, displayName: '세 번째 방문' });
  assert.equal(slots[0]?.remainingVisits, 2);
});

test('old campaign collectibles do not unlock current campaign goals', () => {
  const slots = buildMerchantGoals(campaignMerchants, [], [
    { merchantId: 'one', campaignId: 'old', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' },
  ], '2026-09-28T00:00:00Z');
  assert.deepEqual(slots[0]?.earnedGoals, []);
  assert.equal(slots[0]?.nextGoal?.targetVisitCount, 1);
});

test('completed, ended and full campaigns retain honest goal state', () => {
  const earned = [1, 3].map((targetVisitCount) => ({
    merchantId: 'one', campaignId: 'current', targetVisitCount: targetVisitCount as 1 | 3,
    appCollectibleStatus: 'COLLECTED' as const,
  }));
  assert.equal(buildMerchantGoals(campaignMerchants, [], earned, '2026-09-28T00:00:00Z')[0]?.nextGoal, null);
  assert.equal(buildMerchantGoals(campaignMerchants, [], [], '2026-10-02T00:00:00Z')[0]?.campaignStatus, 'ended');
  assert.equal(buildMerchantGoals([{
    ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, enrollmentStatus: 'FULL' },
  }], [], [], '2026-09-28T00:00:00Z')[0]?.campaignStatus, 'full');
  assert.deepEqual(buildMerchantGoals([], [], [], '2026-09-28T00:00:00Z'), []);
});

test('full campaign shows capacity and the unearned goal without promising another reward', () => {
  const [goal] = buildMerchantGoals([{
    ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, enrollmentStatus: 'FULL' },
  }], [], [], '2026-09-28T00:00:00Z');
  assert.equal(describeMerchantGoal(goal!), '참여 정원 마감 · 미획득 목표 1회 · 첫 방문');
});

test('full campaign retains remaining counted visits for an existing participant', () => {
  const full = [{
    ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, enrollmentStatus: 'FULL' as const },
  }];
  const visits = [
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
    { merchantId: 'one', campaignId: 'current', progressCounted: false },
  ];
  const earned = [{ merchantId: 'one', campaignId: 'current', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' }] as const;
  const [goal] = buildMerchantGoals(full, visits, earned, '2026-09-28T00:00:00Z');
  assert.equal(goal?.remainingVisits, 2);
  assert.equal(describeMerchantGoal(goal!), '참여 정원 마감 · 미획득 목표 3회 · 세 번째 방문 · 기존 참여자라면 2회 남음');
});

test('ended campaign still shows earned completion and pending collectible state', () => {
  const ended = '2026-10-02T00:00:00Z';
  const earned = [{ merchantId: 'one', campaignId: 'current', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' }] as const;
  const [pending] = buildMerchantGoals(campaignMerchants, [
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
    { merchantId: 'one', campaignId: 'current', progressCounted: true },
  ], earned, ended);
  assert.equal(describeMerchantGoal(pending!), '캠페인 종료 · 앱 수집품 반영 확인 중');
  const complete = buildMerchantGoals(campaignMerchants, [], [
    ...earned, { merchantId: 'one', campaignId: 'current', targetVisitCount: 3, appCollectibleStatus: 'COLLECTED' },
  ], ended)[0]!;
  assert.equal(describeMerchantGoal(complete), '캠페인 종료 · 앱 수집품 목표 완료');
});

test('campaign change drops old progress and earned goals after catalog refresh', () => {
  const visits = [{ merchantId: 'one', campaignId: 'current', progressCounted: true }];
  const earned = [{ merchantId: 'one', campaignId: 'current', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' }] as const;
  const refreshed = [{ ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, id: 'new' } }];
  const [goal] = buildMerchantGoals(refreshed, visits, earned, '2026-09-28T00:00:00Z');
  assert.equal(goal?.progressCount, 0);
  assert.deepEqual(goal?.earnedGoals, []);
  assert.equal(goal?.nextGoal?.targetVisitCount, 1);
});

test('a merchant with one or more matching visits is marked visited with a visit count', () => {
  const slots = buildStampSlots(merchants, [
    { merchantId: 'one' },
    { merchantId: 'one' },
    { merchantId: 'two' },
  ]);
  assert.deepEqual(slots, [
    { merchantId: 'one', merchantName: '가상 점포 A', visited: true, visitCount: 2 },
    { merchantId: 'two', merchantName: '가상 점포 B', visited: true, visitCount: 1 },
    { merchantId: 'three', merchantName: '가상 점포 C', visited: false, visitCount: 0 },
  ]);
});

test('a merchant with no visits at all is marked not visited with a zero count', () => {
  const slots = buildStampSlots(merchants, []);
  assert.ok(slots.every((slot) => !slot.visited && slot.visitCount === 0));
});

test('an empty merchant catalog yields no stamp slots, even with visits present', () => {
  assert.deepEqual(buildStampSlots([], [{ merchantId: 'one' }]), []);
});

test('a visit for a merchant id outside the current public catalog is ignored, not shown as a phantom slot', () => {
  const slots = buildStampSlots(merchants, [{ merchantId: 'unlisted-merchant' }]);
  assert.equal(slots.length, 3);
  assert.ok(slots.every((slot) => !slot.visited));
});

test('matching is by merchant id, not by display name', () => {
  const renamed: readonly Pick<PublicMerchant, 'id' | 'name'>[] = [
    { id: 'one', name: '다른 이름으로 바뀐 가게' },
  ];
  const slots = buildStampSlots(renamed, [{ merchantId: 'one' }]);
  assert.deepEqual(slots, [
    { merchantId: 'one', merchantName: '다른 이름으로 바뀐 가게', visited: true, visitCount: 1 },
  ]);
});

test('stamp grid drops to two columns only below the narrow-width threshold', () => {
  assert.equal(stampColumnCount(360), 3);
  assert.equal(stampColumnCount(340), 3);
  assert.equal(stampColumnCount(339), 2);
});

test('stamp grid uses fewer columns when system font scale grows', () => {
  assert.equal(stampColumnCount(412, 1.3), 2);
  assert.equal(stampColumnCount(412, 2), 1);
  assert.equal(stampColumnCount(360, 2), 1);
  assert.equal(stampColumnCount(412, 0.85), 3);
});
