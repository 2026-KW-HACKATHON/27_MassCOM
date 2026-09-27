export type ShowcaseCollectibleArtKey = 'a' | 'b' | 'c';

export function showcaseCollectibleArtKey(merchantId: string): ShowcaseCollectibleArtKey | undefined {
  switch (merchantId) {
    case 'showcase-local-merchant': return 'a';
    case 'showcase-local-merchant-b': return 'b';
    case 'showcase-local-merchant-c': return 'c';
    default: return undefined;
  }
}
