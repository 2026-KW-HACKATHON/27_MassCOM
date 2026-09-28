import type { CollectionSnapshot } from '@/commerce/commerce-api';

type CountInput = {
  visits: readonly unknown[];
  collectibles: readonly Pick<CollectionSnapshot['collectibles'][number], 'nftStatus'>[];
};

export function collectionCounts(snapshot: CountInput) {
  return {
    visits: snapshot.visits.length,
    appCollectibles: snapshot.collectibles.length,
    finalizedNfts: snapshot.collectibles.filter((item) => item.nftStatus === 'FINALIZED').length,
  };
}

/** Counts stay one compact row of three unless the text really cannot fit. */
export function shouldStackCounts(width: number, fontScale: number): boolean {
  return width / Math.max(fontScale, 1) < 300 || fontScale >= 1.5;
}
