import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectionCardLayout, earnedDateLabel, groupCollectibles, ungroupedCollectibles } from './collectible-groups';

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

test('the earned date is shown as the Korea-time calendar day, not the UTC date', () => {
  // 10월 5일 06:28 KST = 10월 4일 21:28 UTC
  assert.equal(earnedDateLabel('2026-10-04T21:28:00.000Z'), '10월 5일');
  assert.equal(earnedDateLabel('2026-10-04T14:59:59.000Z'), '10월 4일');
  assert.equal(earnedDateLabel('2026-10-04T15:00:00.000Z'), '10월 5일');
  assert.equal(earnedDateLabel('2026-12-31T15:00:00.000Z'), '1월 1일');
});

test('the collection grid uses two columns only when both cards and the gap really fit', () => {
  // 360dp 화면: 격자 320 → 154 + 12 + 154 = 320
  assert.deepEqual(collectionCardLayout(320, 1), { columns: 2, width: 154 });
  // 320dp 화면: 격자 280 → 반 폭 134는 너무 좁아 한 열 전체 폭
  assert.deepEqual(collectionCardLayout(280, 1), { columns: 1, width: 280 });
  // 큰 글씨는 넓은 화면에서도 한 열
  assert.deepEqual(collectionCardLayout(320, 1.5), { columns: 1, width: 320 });
  assert.deepEqual(collectionCardLayout(800, 2), { columns: 1, width: 800 });
  // 넓은 화면
  assert.deepEqual(collectionCardLayout(560, 1.3), { columns: 2, width: 274 });
  for (const width of [300, 312, 313, 320, 411, 600]) {
    const layout = collectionCardLayout(width, 1);
    if (layout.columns === 2) assert.ok(layout.width * 2 + 12 <= width, `two cards fit in ${width}`);
  }
  assert.deepEqual(collectionCardLayout(0, 1), { columns: 1, width: 0 });
  // 소수 폭: 311.6dp는 반 폭이 149.8이라 한 열, 313.6dp는 150 + 12 + 150 = 312로 두 열이 들어간다.
  for (const measured of [311.6, 313.6]) {
    const layout = collectionCardLayout(Math.floor(measured), 1);
    if (layout.columns === 2) assert.ok(layout.width * 2 + 12 <= measured);
  }
  assert.equal(collectionCardLayout(Math.floor(311.6), 1).columns, 1);
  assert.deepEqual(collectionCardLayout(Math.floor(313.6), 1), { columns: 2, width: 150 });
  assert.equal(collectionCardLayout(311.6, 1).columns, 1);
});
