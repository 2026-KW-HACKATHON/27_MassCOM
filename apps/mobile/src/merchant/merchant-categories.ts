// 점포 업종(Issue #254, #331). 서버 migration 0036의 CHECK와 apps/api/src/merchant-profile-rules.ts의 목록과 같은 값·같은 순서다.
// 업종 칩은 이 순서대로 늘어선다.
export const merchantCategories = ['한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타'] as const;
export type MerchantCategory = (typeof merchantCategories)[number];

/**
 * 응답의 category를 안전하게 읽는다. 없거나(옛 서버) 모르는 값(새 서버가 업종을 늘린 경우)이면 null이라 그 가게는 업종 칩에서만
 * 빠지고 목록에는 그대로 남는다. 공백을 다듬어 주지 않는다: 서버가 이미 정규화한 값만 오기 때문이다.
 */
export function parseMerchantCategory(value: unknown): MerchantCategory | null {
  return typeof value === 'string' && (merchantCategories as readonly string[]).includes(value) ? value as MerchantCategory : null;
}
