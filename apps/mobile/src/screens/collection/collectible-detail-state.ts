import { CommerceApiError } from '../../commerce/commerce-api';

/**
 * 상세를 읽지 못한 이유를 화면 문구로 바꾼다. 404는 운영자가 게시 사진·음성을 내렸거나 보유 기록이 바뀐 경우라
 * 다시 불러와도 같으므로 "다시 볼 수 있는 사진이 없는 기존 수집품"으로 안내하고 재시도를 주지 않는다(보상·방문 기록은 그대로다).
 */
export type CollectibleDetailFailure = { removed: true; title: string; body: string } | { removed: false; title: string; body: string };

export function collectibleDetailFailure(error: unknown): CollectibleDetailFailure {
  if (error instanceof CommerceApiError && error.status === 404) {
    return {
      removed: true,
      title: '다시 볼 수 있는 사진이 없어요',
      body: '이 수집품의 사진과 음성은 더 이상 제공되지 않아요. 받은 기록과 보상은 도감에 그대로 남아 있어요.',
    };
  }
  return { removed: false, title: '수집품을 열지 못했어요', body: '수집품을 불러오지 못했어요. 보유 기록은 그대로예요.' };
}
