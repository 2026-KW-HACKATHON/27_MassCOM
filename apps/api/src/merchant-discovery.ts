export const detailViewSources = ['list', 'map', 'recommendation', 'collection', 'friend', 'link', 'other'] as const;
export type DetailViewSource = typeof detailViewSources[number];

export function isDetailViewSource(value: unknown): value is DetailViewSource {
  return typeof value === 'string' && detailViewSources.some((source) => source === value);
}

export type CollectiblePreview = {
  merchantId: string;
  campaignId: string;
  publicationId?: string;
  name: string;
  goals: {
    visitCount: number;
    gradeId: string;
    gradeName: string;
    shape: string;
    theme: string;
    thumbnailDataUrl: string | null;
  }[];
};

export type MerchantDiscoveryErrorCode = 'COLLECTIBLE_PREVIEW_NOT_FOUND' | 'MERCHANT_NOT_FOUND';

export class MerchantDiscoveryError extends Error {
  constructor(readonly code: MerchantDiscoveryErrorCode) {
    super(code);
  }
}

export interface CollectiblePreviewService {
  preview(merchantId: string): Promise<CollectiblePreview>;
}

export interface MerchantDetailViewService {
  record(merchantId: string, source: DetailViewSource): Promise<void>;
}
