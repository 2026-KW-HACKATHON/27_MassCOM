// 점포의 동네·업종(Issue #254, D-060). 둘 다 공개 NFT 메타데이터에 들어가고 점포 공개 조건과는 무관하다.
// migration 0036의 DB CHECK와 같은 규칙이다.

// 행정동 이름만: 한글로 시작해 동·가·리로 끝나는 2~10자, 가운데에 숫자·가운뎃점(월계1동·상계3·4동) 허용, 숫자 3자리 이상 연속 금지.
const neighborhoodPattern = /^[가-힣][가-힣0-9·]{0,8}[동가리]$/;

export const merchantCategories = ['한식', '중식', '일식', '양식', '분식', '카페', '베이커리', '주점', '기타'] as const;
export type MerchantCategory = (typeof merchantCategories)[number];

// 앞뒤 공백을 지운 값. 빈 값은 null(비움), 규칙에 맞지 않으면 undefined(거절)다.
export function normalizeNeighborhood(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return null;
  return neighborhoodPattern.test(value) && !/[0-9]{3}/.test(value) ? value : undefined;
}

export function normalizeCategory(raw: unknown): MerchantCategory | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return null;
  return (merchantCategories as readonly string[]).includes(value) ? value as MerchantCategory : undefined;
}

export type MerchantProfileFields = {
  story: string;
  businessHours?: string;
  menuItems?: { name: string; priceWon: number }[];
};

// 운영자 입력은 영업시간·메뉴를 생략할 수 있다. 점주 수정 요청은 경로에서 두 필드를 필수로 검사한다.
export function normalizeMerchantProfileFields(raw: {
  story: unknown; businessHours?: unknown; menuItems?: unknown;
}): MerchantProfileFields | undefined {
  if (typeof raw.story !== 'string' || raw.story.length > 4000 ||
      (raw.businessHours !== undefined && (typeof raw.businessHours !== 'string' || raw.businessHours.length > 1000)) ||
      (raw.menuItems !== undefined && (!Array.isArray(raw.menuItems) || raw.menuItems.length > 30 ||
        raw.menuItems.some(item => !item || typeof item.name !== 'string' || !item.name.trim() ||
          item.name.length > 200 || !Number.isSafeInteger(item.priceWon) || item.priceWon < 0 ||
          item.priceWon > 1_000_000_000)))) return undefined;
  return {
    story: raw.story.trim(),
    ...(raw.businessHours === undefined ? {} : { businessHours: raw.businessHours.trim() }),
    ...(raw.menuItems === undefined ? {} : {
      menuItems: raw.menuItems.map(item => ({ name: item.name.trim(), priceWon: item.priceWon })),
    }),
  };
}
