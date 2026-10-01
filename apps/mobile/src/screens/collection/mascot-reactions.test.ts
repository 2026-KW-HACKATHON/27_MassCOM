import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectibleGroup } from './collectible-groups';
import {
  currentReactionEvent,
  dismissReactionEvent,
  eligibleReactionEvents,
  enqueueReactionEvents,
  pendingReactionEvents,
  reactionEventKey,
  reactionKeyToPersist,
  reactionMessage,
  type ReactionQueue,
} from './mascot-reactions';
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

test('enqueueReactionEvents never duplicates an event already waiting in the queue', () => {
  const first = { kind: 'first-collectible' as const };
  const store = { kind: 'first-store' as const, merchantId: 'm1', merchantName: '가게1' };
  const queue = enqueueReactionEvents([], [first, store]);
  assert.deepEqual(enqueueReactionEvents(queue, [first]).map(reactionEventKey), queue.map(reactionEventKey));
  assert.equal(enqueueReactionEvents(queue, [first]).length, 2);
});

test('currentReactionEvent reads the queue head and dismissReactionEvent drops it', () => {
  const first = { kind: 'first-collectible' as const };
  const store = { kind: 'first-store' as const, merchantId: 'm1', merchantName: '가게1' };
  const queue = enqueueReactionEvents([], [first, store]);
  assert.deepEqual(currentReactionEvent(queue), first);
  const afterDismiss = dismissReactionEvent(queue);
  assert.deepEqual(currentReactionEvent(afterDismiss), store);
  assert.deepEqual(dismissReactionEvent([]), []);
});

test('reactionKeyToPersist only ever names the event on screen, never a queued-but-unseen one', () => {
  const first = { kind: 'first-collectible' as const };
  const store = { kind: 'first-store' as const, merchantId: 'm1', merchantName: '가게1' };
  const queue = enqueueReactionEvents([], [first, store]);
  assert.equal(reactionKeyToPersist(queue, new Set()), reactionEventKey(first));
  // Already persisted: nothing new to persist, even though `store` is still queued and unseen.
  assert.equal(reactionKeyToPersist(queue, new Set([reactionEventKey(first)])), undefined);
  assert.equal(reactionKeyToPersist([], new Set()), undefined);
});

// Regression for the bug where every pending event was marked shown at once but only the first was ever displayed,
// silently dropping first-store/store-complete when several events become eligible in the same tick (index.tsx).
// This drives the exact controller functions index.tsx uses (enqueue → currentReactionEvent → reactionKeyToPersist
// → dismissReactionEvent), not a reimplementation, so reverting index.tsx to call them incorrectly — e.g. persisting
// the whole batch instead of just the current one — cannot be caught here; see the one light source check below.
test('every event that becomes pending in the same tick is eventually shown, one at a time, via the queue controller', () => {
  const eligible = eligibleReactionEvents([group('m1', '가게1'), group('m2', '가게2')], [
    { merchantId: 'm1', merchantName: '가게1', slots: [], completed: true, nextSlot: null },
  ]);
  assert.ok(eligible.length >= 3, '테스트 전제: 같은 틱에 세 개 이상 자격을 얻어야 한다');

  const shown = new Set<string>();
  let queue: ReactionQueue = [];
  const displayedInOrder: string[] = [];
  for (let round = 0; round < eligible.length; round += 1) {
    // Each round mimics one render: newly-eligible-but-not-yet-shown events are enqueued first.
    queue = enqueueReactionEvents(queue, pendingReactionEvents(eligible, shown));
    const key = reactionKeyToPersist(queue, shown);
    assert.ok(key, `round ${round}에 보여줄 이벤트가 있어야 한다`);
    shown.add(key!);
    displayedInOrder.push(key!);
    queue = dismissReactionEvent(queue);
  }
  assert.deepEqual(displayedInOrder.sort(), eligible.map(reactionEventKey).sort());
  assert.deepEqual(pendingReactionEvents(eligible, shown), []);
});

test('reactionMessage names the store for store-scoped events', () => {
  assert.equal(reactionMessage({ kind: 'first-collectible' }), '첫 수집품을 도감에 모았어요!');
  assert.match(reactionMessage({ kind: 'first-store', merchantId: 'm1', merchantName: '가게1' }), /가게1/);
  assert.match(reactionMessage({ kind: 'store-complete', merchantId: 'm1', merchantName: '가게1' }), /가게1/);
});
