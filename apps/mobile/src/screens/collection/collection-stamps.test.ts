import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { buildMerchantGoals, buildStampSlots, describeMerchantGoal, shortMerchantGoal, stampColumnCount, stampGlyph, stampRotation, toPassportStamp } from './collection-stamps';

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

test('visited stamps lean by slot position and repeat the same pattern', () => {
  const angles = Array.from({ length: 10 }, (_, index) => stampRotation(index));
  assert.ok(angles.every((angle) => Math.abs(angle) <= 8 && angle !== 0));
  assert.equal(stampRotation(8), stampRotation(0));
  assert.notEqual(stampRotation(0), stampRotation(1));
});

test('stamp cards show one short goal line while the full sentence stays available', () => {
  const now = '2026-09-28T00:00:00Z';
  const counted = { merchantId: 'one', campaignId: 'current', progressCounted: true };
  const firstEarned = [{ merchantId: 'one', campaignId: 'current', targetVisitCount: 1, appCollectibleStatus: 'COLLECTED' }] as const;
  const [open] = buildMerchantGoals(campaignMerchants, [counted], firstEarned, now);
  assert.equal(shortMerchantGoal(open!), '수집품까지 2번');
  assert.equal(describeMerchantGoal(open!), '다음 목표 3회 · 세 번째 방문 · 2회 남음');

  const [pending] = buildMerchantGoals(campaignMerchants, [counted], [], now);
  assert.equal(shortMerchantGoal(pending!), '수집품 반영 중');

  const allEarned = [...firstEarned, { merchantId: 'one', campaignId: 'current', targetVisitCount: 3, appCollectibleStatus: 'COLLECTED' }] as const;
  assert.equal(shortMerchantGoal(buildMerchantGoals(campaignMerchants, [], allEarned, now)[0]!), '수집품 모두 모음');
  assert.equal(shortMerchantGoal(buildMerchantGoals(campaignMerchants, [], [], '2026-10-02T00:00:00Z')[0]!), '캠페인 종료');
  assert.equal(shortMerchantGoal(buildMerchantGoals(campaignMerchants, [], [], '2026-08-01T00:00:00Z')[0]!), '캠페인 시작 전');

  const full = [{ ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, enrollmentStatus: 'FULL' as const } }];
  assert.equal(shortMerchantGoal(buildMerchantGoals(full, [], [], now)[0]!), '참여 정원 마감');
  assert.equal(shortMerchantGoal(buildMerchantGoals(full, [counted], firstEarned, now)[0]!), '수집품까지 2번');

  const noGoals = [{ ...campaignMerchants[0]!, campaign: { ...campaignMerchants[0]!.campaign, rewardGoals: [] } }];
  assert.equal(shortMerchantGoal(buildMerchantGoals(noGoals, [], [], now)[0]!), '보상 목표 없음');
  for (const goal of [open!, pending!]) assert.ok(shortMerchantGoal(goal).length <= 9);
});

test('passport stamps keep the short goal visible and put status and the full goal in the label for screen readers', () => {
  const now = '2026-09-28T00:00:00Z';
  const counted = { merchantId: 'one', campaignId: 'current', progressCounted: true };
  const [goal] = buildMerchantGoals(campaignMerchants, [counted], [], now);
  const [visitedSlot] = buildStampSlots(merchants, [{ merchantId: 'one' }, { merchantId: 'one' }]);
  const visited = toPassportStamp(visitedSlot!, goal!);
  assert.equal(visited.merchantId, 'one');
  assert.equal(visited.name, '가상 점포 A');
  assert.equal(visited.visited, true);
  assert.equal(visited.statusText, '방문 2회');
  assert.equal(visited.goalText, shortMerchantGoal(goal!));
  // The tap ("음식점 상세 보기") is the hint on the slot, so the label is only what the stamp is.
  assert.equal(
    visited.label,
    `가상 점포 A 도장 받음, 방문 2회, 보상 진행 1/1회 · 앱 수집품 0/2, ${describeMerchantGoal(goal!)}`,
  );

  const [, , unvisitedSlot] = buildStampSlots(merchants, []);
  const unvisited = toPassportStamp(unvisitedSlot!, goal!);
  assert.equal(unvisited.visited, false);
  assert.equal(unvisited.statusText, '아직 안 가봤어요');
  assert.equal(
    unvisited.label,
    `가상 점포 C 도장 아직 없음, 보상 진행 1/1회 · 앱 수집품 0/2, ${describeMerchantGoal(goal!)}`,
  );
  assert.equal(unvisited.glyph, 'C');
});

test('a stamp glyph is the last word of the name when it is short, else its first two characters', () => {
  // Every demo store starts with "가상", which used to read as the same stamp three times.
  assert.equal(stampGlyph('가상 점포 A'), 'A');
  assert.equal(stampGlyph('가상 점포 B'), 'B');
  assert.equal(stampGlyph('가상 점포 C'), 'C');
  assert.equal(stampGlyph('월계 한식당'), '한식');
  assert.equal(stampGlyph('월계 김밥'), '김밥');
  assert.equal(stampGlyph('맛있는 집'), '집');
  assert.equal(stampGlyph('국수집'), '국수');
  assert.equal(stampGlyph('  월계   분식  '), '분식');
  assert.equal(stampGlyph('Wolgye Cafe'), 'Ca');
  assert.equal(stampGlyph(''), '·');
  assert.equal(stampGlyph('   '), '·');
  // Two Unicode characters, not two UTF-16 units.
  assert.equal(stampGlyph('맛집 🍜🍜🍜'), '🍜🍜');
});

test('a passport stamp carries the art path the owner chose, or null', () => {
  const [goal] = buildMerchantGoals(campaignMerchants, [], [], '2026-09-28T00:00:00Z');
  const [slot] = buildStampSlots(merchants, [{ merchantId: 'one' }]);
  const artUrl = `/merchant-art/${'ef'.repeat(32)}.webp`;
  assert.equal(toPassportStamp(slot!, goal!).artUrl, null);
  assert.equal(toPassportStamp(slot!, goal!, null).artUrl, null);
  assert.equal(toPassportStamp(slot!, goal!, artUrl).artUrl, artUrl);
});
