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

test('collection counts stack on narrow screens or large system text', () => {
  assert.equal(shouldStackCounts(360, 1), true);
  assert.equal(shouldStackCounts(412, 1), false);
  assert.equal(shouldStackCounts(412, 2), true);
});
