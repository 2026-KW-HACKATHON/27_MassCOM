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

export function shouldStackCounts(width: number, fontScale: number): boolean {
  return width < 380 || fontScale >= 1.5;
}
