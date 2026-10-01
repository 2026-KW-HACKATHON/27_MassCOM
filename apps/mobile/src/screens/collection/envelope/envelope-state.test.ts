import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoreSeries } from '../store-series';
import {
  kindCount,
  milestoneForBatch,
  newEntitlementIds,
  seriesForBatch,
  startCards,
  stepCard,
  type EnvelopeCollectibleLite,
} from './envelope-state';

const art = (publicationId: string, gradeId = 'bronze') => ({
  publicationId, projectId: 'p', gradeId, gradeName: '브론즈', name: '가게 우표', shape: 'stamp' as const, theme: { name: '기본' }, thumbnailDataUrl: 'data:image/png;base64,AAAA',
});

const item = (entitlementId: string, publicationId: string, earnedAt: string, merchantId = 'm1'): EnvelopeCollectibleLite => ({
  entitlementId, merchantId, merchantName: '월계 밥상', earnedAt, artwork: art(publicationId),
});

test('startCards opens on the first card, or lands straight on the end card when nothing loaded', () => {
  assert.deepEqual(startCards(3), { stage: 'cards', index: 0 });
  assert.deepEqual(startCards(0), { stage: 'end' });
});

test('stepCard advances and retreats within the cards, landing on the end card past the last one', () => {
  assert.deepEqual(stepCard({ stage: 'cards', index: 0 }, 3, 1), { stage: 'cards', index: 1 });
  assert.deepEqual(stepCard({ stage: 'cards', index: 1 }, 3, 1), { stage: 'cards', index: 2 });
  assert.deepEqual(stepCard({ stage: 'cards', index: 2 }, 3, 1), { stage: 'end' });
  assert.deepEqual(stepCard({ stage: 'cards', index: 1 }, 3, -1), { stage: 'cards', index: 0 });
});

test('stepCard never steps before the first card', () => {
  assert.deepEqual(stepCard({ stage: 'cards', index: 0 }, 3, -1), { stage: 'cards', index: 0 });
});

test('stepCard backward from the end card returns to the last card', () => {
  assert.deepEqual(stepCard({ stage: 'end' }, 3, -1), { stage: 'cards', index: 2 });
});

test('stepCard with no cards always stays on the end card', () => {
  assert.deepEqual(stepCard({ stage: 'cards', index: 0 }, 0, 1), { stage: 'end' });
  assert.deepEqual(stepCard({ stage: 'end' }, 0, -1), { stage: 'end' });
});

test('newEntitlementIds marks an entitlement NEW only when the account held none of its kind before this batch', () => {
  const collectibles = [
    item('old', 'p-coin', '2026-01-01T00:00:00Z'), // already owned before this claim
    item('repeat', 'p-coin', '2026-10-01T00:00:00Z'), // this claim granted the same kind again
    item('new-1', 'p-stamp', '2026-10-01T00:00:00Z'), // this claim's first of its kind
  ];
  assert.deepEqual(newEntitlementIds(['repeat', 'new-1'], collectibles), new Set(['new-1']));
});

test('newEntitlementIds marks every entitlement of a kind NEW when the whole batch introduces it at once', () => {
  const collectibles = [
    item('a', 'p-coin', '2026-10-01T00:00:00Z'),
    item('b', 'p-coin', '2026-10-01T00:00:00Z'),
  ];
  assert.deepEqual(newEntitlementIds(['a', 'b'], collectibles), new Set(['a', 'b']));
});

test('newEntitlementIds ignores a legacy entitlement without artwork', () => {
  const noArtwork: EnvelopeCollectibleLite = { entitlementId: 'legacy', merchantId: 'm1', merchantName: '월계 밥상', earnedAt: '2026-01-01T00:00:00Z' };
  assert.deepEqual(newEntitlementIds(['legacy'], [noArtwork]), new Set());
});

test('kindCount counts distinct published picture+grade combinations, not raw entitlements', () => {
  const collectibles = [
    item('a', 'p1', '2026-01-01T00:00:00Z'),
    item('b', 'p1', '2026-01-02T00:00:00Z'),
    item('c', 'p2', '2026-01-03T00:00:00Z'),
  ];
  assert.equal(kindCount(collectibles), 2);
});

test('milestoneForBatch reports the highest threshold this batch\'s new kinds crossed', () => {
  const before = Array.from({ length: 4 }, (_, i) => item(`e${i}`, `p${i}`, `2026-01-0${i + 1}T00:00:00Z`));
  const batch = ['new-a', 'new-b'];
  const collectibles = [...before, item('new-a', 'p-new-a', '2026-10-01T00:00:00Z'), item('new-b', 'p-new-b', '2026-10-01T00:00:01Z')];
  assert.deepEqual(milestoneForBatch(batch, collectibles), { reached: true, count: 5 });
});

test('milestoneForBatch reports not reached when no threshold is crossed', () => {
  const before = Array.from({ length: 1 }, (_, i) => item(`e${i}`, `p${i}`, `2026-01-0${i + 1}T00:00:00Z`));
  const collectibles = [...before, item('new-a', 'p-new-a', '2026-10-01T00:00:00Z')];
  assert.deepEqual(milestoneForBatch(['new-a'], collectibles), { reached: false });
});

test('milestoneForBatch does not re-report a threshold the account already reached before this batch', () => {
  const before = Array.from({ length: 5 }, (_, i) => item(`e${i}`, `p${i}`, `2026-01-0${i + 1}T00:00:00Z`));
  const collectibles = [...before, item('new-a', 'p-new-a', '2026-10-01T00:00:00Z')];
  assert.deepEqual(milestoneForBatch(['new-a'], collectibles), { reached: false });
});

test('seriesForBatch finds the series for the batch\'s merchant and ignores series for other merchants', () => {
  const collectibles = [item('a', 'p1', '2026-10-01T00:00:00Z', 'merchant-9')];
  const series: readonly StoreSeries[] = [
    { merchantId: 'merchant-1', merchantName: '다른 가게', slots: [], completed: false, nextSlot: null },
    { merchantId: 'merchant-9', merchantName: '월계 밥상', slots: [], completed: false, nextSlot: null },
  ];
  assert.equal(seriesForBatch(series, collectibles, ['a'])?.merchantId, 'merchant-9');
});

test('seriesForBatch is undefined when the batch\'s merchant has no series', () => {
  const collectibles = [item('a', 'p1', '2026-10-01T00:00:00Z', 'merchant-9')];
  assert.equal(seriesForBatch([], collectibles, ['a']), undefined);
});
