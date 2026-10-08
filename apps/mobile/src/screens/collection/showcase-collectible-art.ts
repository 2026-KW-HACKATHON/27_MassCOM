export type ShowcaseCollectibleArtKey = 'a' | 'b' | 'c';

export function collectibleArtSize(viewportWidth: number, pageInset: number, cardPadding: number): number {
  return Math.max(1, viewportWidth - pageInset * 2 - cardPadding * 2);
}

export function showcaseCollectibleArtKey(packageId: string | null | undefined, merchantId: string): ShowcaseCollectibleArtKey | undefined {
  if (packageId !== 'kr.masscom.wolgye.demo') return undefined;
  switch (merchantId) {
    case 'showcase-wolgye-MA010120220813334279': return 'b';
    case 'showcase-wolgye-MA010120220809686086': return 'b';
    case 'showcase-wolgye-MA010120220812445724': return 'c';
    default: return undefined;
  }
}
