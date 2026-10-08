import type { BenefitState, WindowStatus } from './campaign-purpose-rules.js';

// 점주 목적형 캠페인의 시간대 조건(Issue #412, D-092)에서 이 방문 코드를 확정한 시각이 시간대 안인지.
// 방문 인정은 시간대와 무관하다(D1): 밖이어도 방문·코인·진행은 그대로 세고 혜택만 없다. 시간대 조건이 없으면 NONE이다.
export type ClaimWindowStatus = WindowStatus;
// 고객이 방문을 확정했을 때의 혜택 상태. 지금은 시간대 조건만 본다(ELIGIBLE = 시간대 안, NONE = 조건 없음).
export type ClaimBenefit = { state: BenefitState };

export type IssuedClaimSlot = {
  claimSlotId: string;
  token: string;
  tokenVersion: number;
  expiresAt: string;
  // 추가 필드: 시연 테스트 방문(issueShowcaseTestSlot)에는 없다. 옛 클라이언트는 모르는 필드를 무시한다.
  windowStatus?: ClaimWindowStatus;
};

export type ExistingClaimSlot = Omit<IssuedClaimSlot, 'token'> & { replayed: true };

export type RedeemedClaimSlot = {
  claimSlotId: string;
  merchantId: string;
  merchantName: string;
  campaignTitle: string;
  status: 'CLAIMED';
  replayed: boolean;
  visit: {
    visitEventId: string;
    campaignId: string;
    businessDate: string;
    verificationLevel: 'MERCHANT_CONFIRMED';
    progressCounted: boolean;
    progressVisitCount: number;
    // 세어지지 않은 이유가 직원 본인 계정 적립일 때만 넣는다(같은 날 두 번째 방문에는 넣지 않는다).
    progressExcludedReason?: 'STAFF_SELF';
  };
  grantedRewards: readonly {
    entitlementId: string;
    targetVisitCount: 1 | 3 | 5;
    status: 'GRANTED';
    claimExpiresAt: string;
  }[];
  // 추가 필드(Issue #412). 기준 시각은 점원이 코드를 발급·확정한 시각(claim_slots.created_at)이다.
  benefit?: ClaimBenefit;
};

export type ClaimSlotPreview = {
  claimSlotId: string;
  merchantId: string;
  merchantName: string;
  campaignId: string;
  campaignTitle: string;
  expiresAt: string;
  status: 'AVAILABLE' | 'EXPIRED';
};

export interface ClaimSlotService {
  issue(input: {
    merchantId: string;
    customerAccountId: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot>;
  issue(input: {
    merchantId: string;
    customerIdentityToken: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot | ExistingClaimSlot>;
  reissue(input: {
    merchantId: string;
    claimSlotId: string;
    expectedTokenVersion: number;
    requestedByAccountId: string;
  }): Promise<IssuedClaimSlot>;
  preview(input: { accountId: string; token: string }): Promise<ClaimSlotPreview>;
  redeem(input: { accountId: string; token: string }): Promise<RedeemedClaimSlot>;
  // 시연 전용(#295): 실제 QR 없이 가상 점포 방문을 만든다. 반환된 token을 redeem()에 그대로 넘겨야 방문이 확정된다.
  issueShowcaseTestSlot(input: { merchantId: string; accountId: string }): Promise<IssuedClaimSlot>;
}

export type ClaimSlotErrorCode =
  | 'CLAIM_SLOT_ALREADY_EXISTS'
  | 'CLAIM_SLOT_NOT_REISSUABLE'
  | 'CLAIM_TOKEN_UNAVAILABLE'
  | 'CLAIM_TOKEN_EXPIRED'
  | 'CLAIM_CAMPAIGN_UNAVAILABLE'
  | 'CLAIM_MERCHANT_INACTIVE'
  | 'CUSTOMER_IDENTITY_UNAVAILABLE'
  | 'CUSTOMER_IDENTITY_EXPIRED'
  | 'SHOWCASE_MERCHANT_NOT_FOUND'
  | 'ACCOUNT_DELETED';

export class ClaimSlotError extends Error {
  constructor(readonly code: ClaimSlotErrorCode) {
    super(code);
    this.name = 'ClaimSlotError';
  }
}
