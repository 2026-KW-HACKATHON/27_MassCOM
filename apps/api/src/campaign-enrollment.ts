export type CampaignEnrollmentResult = {
  enrollmentId: string;
  campaignId: string;
  accountId: string;
  enrolledAt: string;
  created: boolean;
};

export interface CampaignEnrollmentService {
  enroll(input: { campaignId: string; accountId: string }): Promise<CampaignEnrollmentResult>;
}

export type CampaignEnrollmentErrorCode =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_NOT_AVAILABLE'
  | 'CAMPAIGN_FULL'
  | 'ACCOUNT_DELETED';

export class CampaignEnrollmentError extends Error {
  constructor(readonly code: CampaignEnrollmentErrorCode) {
    super(code);
    this.name = 'CampaignEnrollmentError';
  }
}
