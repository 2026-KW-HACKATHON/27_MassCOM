import type { BadgeCoupon } from './badge-rewards.js';

export type CampaignBenefitInput = {
  adminAccountId: string;
  campaignId: string;
  title: unknown;
  detail: unknown;
  validDays: unknown;
  unitExtraCostWon: unknown;
  maxUses: unknown;
  consentDocumentRef: unknown;
  consent: unknown;
};

export type CampaignBenefitStatus = {
  id: string;
  campaignId: string;
  merchantId: string;
  title: string;
  detail: string;
  status: 'ACTIVE' | 'PAUSED';
  validDays: number;
  maxUses: number;
  issuedCount: number;
  unitExtraCostWon: number;
  issued: number;
  redeemed: number;
  usable: number;
  expiredUnused: number;
  additionalIssuable: number;
  costBorne: string;
  maxExposure: string;
  promisedMaxCost: string;
};

export type CustomerCampaignBenefit = {
  benefitId: string;
  campaignId: string;
  merchantId: string;
  merchantName: string;
  title: string;
  detail: string;
  state: 'CLAIMABLE' | 'CAP_REACHED' | 'OWNED';
  coupon?: BadgeCoupon & { usableFrom: string };
};

export type CampaignBenefitErrorCode =
  | 'ADMIN_FORBIDDEN' | 'ADMIN_INVALID_INPUT' | 'ADMIN_DOCUMENT_REF_INVALID'
  | 'CAMPAIGN_NOT_FOUND' | 'CAMPAIGN_NOT_AVAILABLE' | 'BENEFIT_ALREADY_ACTIVE'
  | 'BENEFIT_NOT_FOUND' | 'BENEFIT_NOT_ELIGIBLE' | 'BENEFIT_PAUSED' | 'CAP_REACHED'
  | 'MERCHANT_NOT_ACTIVE' | 'OWNER_FORBIDDEN' | 'ACCOUNT_DELETED';

export class CampaignBenefitError extends Error {
  constructor(readonly code: CampaignBenefitErrorCode) {
    super(code);
    this.name = 'CampaignBenefitError';
  }
}

export interface CampaignBenefitService {
  createBenefit(input: CampaignBenefitInput): Promise<CampaignBenefitStatus>;
  pauseBenefit(input: { adminAccountId: string; campaignId: string }): Promise<CampaignBenefitStatus>;
  getBenefitStatus(input: { accountId: string; campaignId: string; merchantId?: string }):
    Promise<{ benefit: CampaignBenefitStatus | null; benefits: CampaignBenefitStatus[] }>;
  listBenefits(accountId: string): Promise<{ benefits: CustomerCampaignBenefit[] }>;
  claimBenefit(input: { accountId: string; benefitId: string }): Promise<{ coupon: BadgeCoupon; replayed: boolean }>;
}
