import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { homeVisitGoal } from './visit-goal';

const now = Date.parse('2026-10-07T12:00:00Z');
const merchant = (id: string, status: 'OPEN' | 'FULL' = 'OPEN', endsAt = '2026-11-01T00:00:00Z'): PublicMerchant => ({
  id, name: `가게 ${id}`, story: '', roadAddress: '', minimumSpendWon: 0, menuItems: [], businessHours: '',
  category: null, demo: true, artUrl: null, visitorTags: [],
  campaign: { id: `${id}-campaign`, title: '방문', startsAt: '2026-09-01T00:00:00Z', endsAt,
    enrollmentStatus: status, rewardGoals: [1, 3, 5].map((targetVisitCount) => ({ targetVisitCount: targetVisitCount as 1 | 3 | 5, displayName: '보상' })) },
});
const visit = (id: string, date: string, progressCounted = true): CollectionSnapshot['visits'][number] => ({
  visitEventId: `${id}-${date}`, merchantId: id, merchantName: `가게 ${id}`, campaignId: `${id}-campaign`,
  campaignTitle: '방문', businessDate: date, progressCounted, verificationLevel: 'MERCHANT_CONFIRMED',
});
const collection = (visits: CollectionSnapshot['visits'] = []): CollectionSnapshot => ({ visits, collectibles: [] });

test('home visit goal ignores expired campaigns even when they have past visits', () => {
  assert.equal(homeVisitGoal([merchant('old', 'OPEN', '2026-10-01T00:00:00Z')], collection([visit('old', '2026-09-30')]), now), null);
});

test('home visit goal excludes a full campaign for a new visitor', () => {
  assert.equal(homeVisitGoal([merchant('full', 'FULL')], collection(), now), null);
});

test('home visit goal keeps a full campaign for an enrolled visitor', () => {
  assert.deepEqual(homeVisitGoal([merchant('full', 'FULL')], collection([visit('full', '2026-10-06')]), now),
    { merchantId: 'full', name: '가게 full', count: 1, goals: [1, 3, 5], next: 3 });
});

test('home visit goal does not enroll a visitor through a canceled visit', () => {
  assert.equal(homeVisitGoal([merchant('full', 'FULL')], collection([visit('full', '2026-10-06', false)]), now), null);
});

test('home visit goal omits canceled visits from progress', () => {
  assert.equal(homeVisitGoal([merchant('open')], collection([visit('open', '2026-10-06', false)]), now)?.count, 0);
});

test('home visit goal chooses the most recently visited active campaign', () => {
  const goal = homeVisitGoal([merchant('a'), merchant('b')], collection([visit('a', '2026-10-05'), visit('b', '2026-10-06')]), now);
  assert.equal(goal?.merchantId, 'b');
});
