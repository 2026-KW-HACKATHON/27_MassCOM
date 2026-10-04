import assert from 'node:assert/strict';
import test from 'node:test';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { PublicMerchant } from './merchant-api';
import { buildExplorationSummary } from './home-exploration';

const now = new Date('2026-10-04T14:30:00Z'); // Sunday 23:30 in Seoul.

function merchant(id: string, options: { campaignId?: string; status?: 'OPEN' | 'FULL'; startsAt?: string; endsAt?: string; goals?: (1 | 3 | 5)[] } = {}): PublicMerchant {
  return {
    id, name: `Store ${id}`, story: '', roadAddress: 'Address', minimumSpendWon: 0, menuItems: [], businessHours: '', category: null,
    demo: false, artUrl: null, visitorTags: [],
    campaign: { id: options.campaignId ?? `${id}-campaign`, title: 'Current', startsAt: options.startsAt ?? '2026-09-01T00:00:00Z',
      endsAt: options.endsAt ?? '2026-11-01T00:00:00Z', enrollmentStatus: options.status ?? 'OPEN',
      rewardGoals: (options.goals ?? [1, 3, 5]).map((targetVisitCount) => ({ targetVisitCount, displayName: `${targetVisitCount} visit` })) },
  };
}

function visit(merchantId: string, businessDate: string, progressCounted = true, campaignId = `${merchantId}-campaign`): CollectionSnapshot['visits'][number] {
  return { visitEventId: `${merchantId}-${businessDate}-${campaignId}`, merchantId, merchantName: merchantId, campaignId, campaignTitle: 'Current',
    businessDate, progressCounted, verificationLevel: 'MERCHANT_CONFIRMED' };
}

function collectible(merchantId: string, targetVisitCount: 1 | 3 | 5, campaignId = `${merchantId}-campaign`): CollectionSnapshot['collectibles'][number] {
  return { entitlementId: `${merchantId}-${targetVisitCount}-${campaignId}`, merchantId, merchantName: merchantId, campaignId, campaignTitle: 'Current',
    targetVisitCount, displayName: `${targetVisitCount} visit`, earnedAt: '2026-10-01T00:00:00Z', appCollectibleStatus: 'COLLECTED',
    mintJobId: null, recipient: null, nftStatus: 'NOT_REQUESTED', nft: null };
}

function collection(visits: CollectionSnapshot['visits'] = [], collectibles: CollectionSnapshot['collectibles'] = []): CollectionSnapshot {
  return { visits, collectibles };
}

test('KST week rolls on Monday, and only unique counted current-campaign stores count', () => {
  const stores = [merchant('a'), merchant('b'), merchant('c'), merchant('d')];
  const visits = [visit('a', '2026-09-28'), visit('a', '2026-10-04'), visit('a', '2026-10-04', false),
    visit('b', '2026-10-04', true, 'old-campaign'), visit('c', '2026-10-05')];
  const sunday = buildExplorationSummary(stores, collection(visits), now);
  assert.equal(sunday.weekStart, '2026-09-28');
  assert.deepEqual(sunday.weekly, { current: 1, target: 3, completed: false, nextMerchantId: 'b' });
  const monday = buildExplorationSummary(stores, collection(visits), new Date('2026-10-04T15:00:00Z'));
  assert.equal(monday.weekStart, '2026-10-05');
  assert.equal(monday.weekly.current, 1);
  assert.equal(monday.weekly.nextMerchantId, 'b');
});

test('FULL store is suggested only after this account has a counted visit in its current campaign', () => {
  const stores = [merchant('full', { status: 'FULL' }), merchant('open')];
  assert.deepEqual(buildExplorationSummary(stores, collection(), now).weekly, { current: 0, target: 1, completed: false, nextMerchantId: 'open' });
  const enrolled = buildExplorationSummary(stores, collection([visit('full', '2026-09-10')]), now);
  assert.equal(enrolled.weekly.target, 2);
  assert.equal(enrolled.weekly.nextMerchantId, 'open');
  assert.equal(buildExplorationSummary(stores, collection([visit('full', '2026-09-10', false)]), now).weekly.target, 1);
});

test('expired and future campaigns create no available goals or phantom completion', () => {
  const stores = [merchant('expired', { endsAt: '2026-10-01T00:00:00Z' }), merchant('future', { startsAt: '2026-10-10T00:00:00Z' })];
  assert.deepEqual(buildExplorationSummary(stores, collection([visit('expired', '2026-09-30')]), now), {
    weekStart: '2026-09-28', weekly: { current: 0, target: 0, completed: false }, series: { completed: 0, total: 0 },
  });
});

test('series counts distinct owned milestone levels only for the current campaign', () => {
  const stores = [merchant('a', { goals: [1, 3, 5] }), merchant('b', { goals: [1, 3] })];
  const owned = [collectible('a', 1), collectible('a', 1), collectible('a', 3, 'old-campaign'), collectible('b', 1), collectible('b', 3)];
  const summary = buildExplorationSummary(stores, collection([], owned), now);
  assert.deepEqual(summary.series, { completed: 3, total: 5, nextMerchantId: 'a' });
});

test('completed weekly goal keeps its win until next week, then offers a real revisit', () => {
  const stores = [merchant('a'), merchant('b')];
  const visits = [visit('a', '2026-10-04'), visit('b', '2026-10-04')];
  assert.deepEqual(buildExplorationSummary(stores, collection(visits), now).weekly, { current: 2, target: 2, completed: true });
  assert.deepEqual(buildExplorationSummary(stores, collection(visits), new Date('2026-10-04T15:00:00Z')).weekly,
    { current: 0, target: 2, completed: false, nextMerchantId: 'a' });
});

test('duplicate catalog rows cannot inflate the number of available stores', () => {
  const same = merchant('a');
  const summary = buildExplorationSummary([same, same], collection(), now);
  assert.deepEqual(summary.weekly, { current: 0, target: 1, completed: false, nextMerchantId: 'a' });
  assert.deepEqual(summary.series, { completed: 0, total: 3, nextMerchantId: 'a' });
});
