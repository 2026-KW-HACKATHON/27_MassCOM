import type { PublicMerchant } from '@/merchant/merchant-api';

/** 친구 응답에는 가게 ID가 없으므로 공개 목록에서 이름이 유일할 때만 상세로 연결한다. */
export function friendStampMerchantId(name: string, merchants: readonly Pick<PublicMerchant, 'id' | 'name'>[]): string | undefined {
  const matches = merchants.filter((merchant) => merchant.name === name);
  return matches.length === 1 ? matches[0]!.id : undefined;
}
