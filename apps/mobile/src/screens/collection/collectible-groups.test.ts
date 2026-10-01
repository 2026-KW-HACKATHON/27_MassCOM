import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupCollectibles, ungroupedCollectibles } from './collectible-groups';

const artworkA = {
  publicationId: 'pub-a', projectId: 'proj-a', gradeId: 'grade-1', gradeName: '1등급',
  name: '가을 은행잎', shape: 'circle' as const, theme: { name: '가을' }, thumbnailDataUrl: 'data:image/png;base64,aa==',
};
const artworkB = {
  publicationId: 'pub-b', projectId: 'proj-b', gradeId: 'grade-2', gradeName: '2등급',
  name: '겨울 눈꽃', shape: 'stamp' as const, theme: { name: '겨울' }, thumbnailDataUrl: 'data:image/png;base64,bb==',
};

// #296: 그룹 카드 안에서도 각 수집품의 발행 상태를 따로 보여주고 민트를 걸 수 있어야 해서, 픽스처에 nftStatus·nft·recipient를 더했다.
const notRequested = { nftStatus: 'NOT_REQUESTED' as const, nft: null, recipient: null };
const finalized = { nftStatus: 'FINALIZED' as const, nft: { chainId: 84532, contractAddress: '0xabc', tokenId: '1' }, recipient: '0xowner' };

test('collectibles without artwork are dropped from the grouped browse view', () => {
  const groups = groupCollectibles([
    { entitlementId: 'e1', merchantId: 'm1', merchantName: '가게', artwork: undefined, earnedAt: '2026-09-19T03:00:00.000Z', ...notRequested },
  ]);
  assert.deepEqual(groups, []);
});

test('the same published picture earned twice groups into one card with a count, sorted dates, and each entitlement keeps its own NFT status', () => {
  const groups = groupCollectibles([
    { entitlementId: 'e1', merchantId: 'm1', merchantName: '가게', artwork: artworkA, earnedAt: '2026-09-01T00:00:00.000Z', ...notRequested },
    { entitlementId: 'e2', merchantId: 'm1', merchantName: '가게', artwork: artworkA, earnedAt: '2026-09-19T00:00:00.000Z', ...finalized },
    { entitlementId: 'e3', merchantId: 'm2', merchantName: '다른 가게', artwork: artworkB, earnedAt: '2026-09-10T00:00:00.000Z', ...notRequested },
  ]);

  assert.equal(groups.length, 2);
  const [first, second] = groups;
  // Most recently earned group first.
  assert.equal(first!.key, 'pub-a:grade-1');
  assert.equal(first!.count, 2);
  assert.deepEqual(first!.entitlementIds, ['e1', 'e2']);
  assert.deepEqual(first!.earnedDates, ['2026-09-19T00:00:00.000Z', '2026-09-01T00:00:00.000Z']);
  // entitlements stays in entitlementIds order (not re-sorted like earnedDates), so index i matches both arrays.
  assert.deepEqual(first!.entitlements.map((entry) => entry.entitlementId), ['e1', 'e2']);
  assert.equal(first!.entitlements[0]!.nftStatus, 'NOT_REQUESTED');
  assert.equal(first!.entitlements[1]!.nftStatus, 'FINALIZED');
  assert.equal(first!.entitlements[1]!.nft?.tokenId, '1');
  assert.equal(second!.key, 'pub-b:grade-2');
  assert.equal(second!.count, 1);
});

test('ungroupedCollectibles returns only the legacy entitlements that groupCollectibles drops, most recent first', () => {
  const legacy = ungroupedCollectibles([
    {
      entitlementId: 'e1', merchantId: 'm1', merchantName: '가게', artwork: undefined, earnedAt: '2026-09-01T00:00:00.000Z',
      displayName: '첫 방문 보상', campaignTitle: '가을 캠페인', targetVisitCount: 1, ...notRequested,
    },
    {
      entitlementId: 'e2', merchantId: 'm1', merchantName: '가게', artwork: artworkA, earnedAt: '2026-09-19T00:00:00.000Z',
      displayName: '그림 있는 보상', campaignTitle: '가을 캠페인', targetVisitCount: 3, ...notRequested,
    },
    {
      entitlementId: 'e3', merchantId: 'm2', merchantName: '다른 가게', artwork: undefined, earnedAt: '2026-09-10T00:00:00.000Z',
      displayName: '옛 보상', campaignTitle: '여름 캠페인', targetVisitCount: 5, ...finalized,
    },
  ]);

  assert.equal(legacy.length, 2);
  assert.deepEqual(legacy.map((item) => item.entitlementId), ['e3', 'e1']);
  assert.equal(legacy[0]!.nftStatus, 'FINALIZED');
  assert.equal(legacy[1]!.displayName, '첫 방문 보상');
});
