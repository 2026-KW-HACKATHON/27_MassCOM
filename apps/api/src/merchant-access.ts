// context 응답에 실려 나가는 권한. 이미 설치된 앱의 파서가 이 두 값만 알고 모르는 값이 오면 응답을 거절하므로, 새 권한은 여기에
// 넣지 않는다.
export const merchantPermissions = ['VIEW_MERCHANT', 'CONFIRM_VISIT'] as const;
// 서버 안에서만 확인하는 권한(응답에 싣지 않음). MANAGE_ART(AI 가게 그림)는 활성 OWNER에게 주고, 활성 STAFF에게는
// `AI_ART_STAFF_MAY_MANAGE=true`인 환경(시연)에서만 준다. 운영에는 OWNER를 부여하는 경로가 아직 없어 기본값은 아무도 못 쓴다(D-048).
export const merchantServerPermissions = ['MANAGE_ART'] as const;

export type MerchantPermission =
  | (typeof merchantPermissions)[number]
  | (typeof merchantServerPermissions)[number];
export type MerchantRole = 'OWNER' | 'STAFF';

export type MerchantAccessGrant = {
  merchantId: string;
  role: MerchantRole;
  permissions: readonly MerchantPermission[];
};

export interface MerchantAccessControl {
  requirePermission(input: {
    accountId: string;
    merchantId: string;
    permission: MerchantPermission;
  }): Promise<MerchantAccessGrant>;
}

export class MerchantAccessError extends Error {
  constructor(readonly code: 'MERCHANT_ACCESS_DENIED') {
    super(code);
    this.name = 'MerchantAccessError';
  }
}
