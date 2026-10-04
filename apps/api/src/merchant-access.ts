// context 응답에 실려 나가는 권한. 이미 설치된 앱의 파서가 이 두 값만 알고 모르는 값이 오면 응답을 거절하므로, 새 권한은 여기에
// 넣지 않는다.
export const merchantPermissions = ['VIEW_MERCHANT', 'CONFIRM_VISIT'] as const;
// 서버 안에서만 확인하는 권한(응답에 싣지 않음). MANAGE_ART(AI 가게 그림)는 활성 OWNER에게 주고, 활성 STAFF에게는
// `AI_ART_STAFF_MAY_MANAGE=true`인 환경(시연)에서만 준다. 운영 OWNER는 관리자 웹에서 확인 뒤 올리지만(D-054) 운영 OpenAI 키가
// 비어 있어 생성은 꺼져 있다(D-048·D-050).
export const merchantServerPermissions = ['MANAGE_ART', 'MANAGE_PROFILE'] as const;

export type MerchantPermission =
  | (typeof merchantPermissions)[number]
  | (typeof merchantServerPermissions)[number];
export type MerchantRole = 'OWNER' | 'STAFF';

// MANAGE_ART 규칙 하나: 활성 OWNER는 항상, 활성 STAFF는 staffMayManageArt인 환경에서만. 요청 시작 때의 권한 검사
// (postgres/merchant-access.ts)와 그림 변경 트랜잭션 안의 재확인(postgres/merchant-art.ts)이 이 함수를 같이 쓴다.
export function canManageArt(role: MerchantRole, staffMayManageArt: boolean): boolean {
  return role === 'OWNER' || staffMayManageArt;
}

export function canManageProfile(role: MerchantRole, staffMayManageArt: boolean): boolean {
  return canManageArt(role, staffMayManageArt);
}

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
