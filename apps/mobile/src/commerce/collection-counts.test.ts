import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectionCounts, shouldStackCounts } from '../screens/collection/collection-counts';

test('queued and confirming collectibles are not finalized NFTs', () => {
  const snapshot = {
    visits: [{}],
    collectibles: [
      { nftStatus: 'NOT_REQUESTED' },
      { nftStatus: 'QUEUED' },
      { nftStatus: 'CONFIRMING' },
      { nftStatus: 'FINALIZED' },
    ],
  } as const;

  assert.deepEqual(collectionCounts(snapshot), {
    visits: 1,
    appCollectibles: 4,
    finalizedNfts: 1,
  });
});

test('collection counts stay in one row and stack only for very narrow screens or large system text', () => {
  assert.equal(shouldStackCounts(360, 1), false);
  assert.equal(shouldStackCounts(412, 1), false);
  assert.equal(shouldStackCounts(290, 1), true);
  assert.equal(shouldStackCounts(412, 1.3), false);
  assert.equal(shouldStackCounts(412, 1.4), true);
  assert.equal(shouldStackCounts(412, 2), true);
});
