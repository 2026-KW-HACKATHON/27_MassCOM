import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectibleGroup } from './collectible-groups';
import { eligibleReactionEvents, pendingReactionEvents, reactionEventKey, reactionMessage } from './mascot-reactions';
import type { StoreSeries } from './store-series';

const artwork = { publicationId: 'p', projectId: 'proj', gradeId: 'g', gradeName: '1등급', name: '이름', shape: 'circle' as const, theme: { name: '가을' }, thumbnailDataUrl: 'data:image/png;base64,aa==' };

function group(merchantId: string, merchantName: string): CollectibleGroup {
  return { key: `${merchantId}-key`, artwork, merchantId, merchantName, count: 1, entitlementIds: ['e1'], earnedDates: ['2026-09-19T00:00:00.000Z'] };
}

test('eligibleReactionEvents fires first-collectible once and one first-store event per owned store', () => {
  const groups = [group('m1', '가게1'), group('m1', '가게1'), group('m2', '가게2')];
  const events = eligibleReactionEvents(groups, []);
  assert.deepEqual(events.map(reactionEventKey).sort(), ['first-collectible', 'first-store:m1', 'first-store:m2'].sort());
});

test('an empty collection is eligible for nothing', () => {
  assert.deepEqual(eligibleReactionEvents([], []), []);
});

test('a completed store series is eligible for store-complete', () => {
  const series: StoreSeries[] = [{ merchantId: 'm1', merchantName: '가게1', slots: [], completed: true, nextSlot: null }];
  const events = eligibleReactionEvents([], series);
  assert.deepEqual(events, [{ kind: 'store-complete', merchantId: 'm1', merchantName: '가게1' }]);
});

test('pendingReactionEvents drops already-shown events and never repeats them', () => {
  const eligible = eligibleReactionEvents([group('m1', '가게1')], []);
  const shown = new Set(['first-collectible']);
  const pending = pendingReactionEvents(eligible, shown);
  assert.deepEqual(pending.map(reactionEventKey), ['first-store:m1']);
  // Once every eligible event is shown, nothing is pending any more.
  assert.deepEqual(pendingReactionEvents(eligible, new Set(eligible.map(reactionEventKey))), []);
});

test('pendingReactionEvents ranks first-collectible above store-complete above first-store', () => {
  const eligible = [
    { kind: 'first-store' as const, merchantId: 'm1', merchantName: '가게1' },
    { kind: 'store-complete' as const, merchantId: 'm1', merchantName: '가게1' },
    { kind: 'first-collectible' as const },
  ];
  const pending = pendingReactionEvents(eligible, new Set());
  assert.deepEqual(pending.map(reactionEventKey), ['first-collectible', 'store-complete:m1', 'first-store:m1']);
});

test('reactionMessage names the store for store-scoped events', () => {
  assert.equal(reactionMessage({ kind: 'first-collectible' }), '첫 수집품을 도감에 모았어요!');
  assert.match(reactionMessage({ kind: 'first-store', merchantId: 'm1', merchantName: '가게1' }), /가게1/);
  assert.match(reactionMessage({ kind: 'store-complete', merchantId: 'm1', merchantName: '가게1' }), /가게1/);
});
