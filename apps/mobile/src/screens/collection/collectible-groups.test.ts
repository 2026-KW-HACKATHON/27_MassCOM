import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupCollectibles } from './collectible-groups';

const artworkA = {
  publicationId: 'pub-a', projectId: 'proj-a', gradeId: 'grade-1', gradeName: '1등급',
  name: '가을 은행잎', shape: 'circle' as const, theme: { name: '가을' }, thumbnailDataUrl: 'data:image/png;base64,aa==',
};
const artworkB = {
  publicationId: 'pub-b', projectId: 'proj-b', gradeId: 'grade-2', gradeName: '2등급',
  name: '겨울 눈꽃', shape: 'stamp' as const, theme: { name: '겨울' }, thumbnailDataUrl: 'data:image/png;base64,bb==',
};

test('collectibles without artwork are dropped from the grouped browse view', () => {
  const groups = groupCollectibles([
    { entitlementId: 'e1', merchantId: 'm1', merchantName: '가게', artwork: undefined, earnedAt: '2026-09-19T03:00:00.000Z' },
  ]);
  assert.deepEqual(groups, []);
});

test('the same published picture earned twice groups into one card with a count and sorted dates', () => {
  const groups = groupCollectibles([
    { entitlementId: 'e1', merchantId: 'm1', merchantName: '가게', artwork: artworkA, earnedAt: '2026-09-01T00:00:00.000Z' },
    { entitlementId: 'e2', merchantId: 'm1', merchantName: '가게', artwork: artworkA, earnedAt: '2026-09-19T00:00:00.000Z' },
    { entitlementId: 'e3', merchantId: 'm2', merchantName: '다른 가게', artwork: artworkB, earnedAt: '2026-09-10T00:00:00.000Z' },
  ]);

  assert.equal(groups.length, 2);
  const [first, second] = groups;
  // Most recently earned group first.
  assert.equal(first!.key, 'pub-a:grade-1');
  assert.equal(first!.count, 2);
  assert.deepEqual(first!.entitlementIds, ['e1', 'e2']);
  assert.deepEqual(first!.earnedDates, ['2026-09-19T00:00:00.000Z', '2026-09-01T00:00:00.000Z']);
  assert.equal(second!.key, 'pub-b:grade-2');
  assert.equal(second!.count, 1);
});
