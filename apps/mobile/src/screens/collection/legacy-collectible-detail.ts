import type { ImageSourcePropType } from 'react-native';

import type { PublishedCollectible } from '../../commerce/collectible-artwork';
import type { UngroupedCollectible } from './collectible-groups';

/** 회전 화면의 표시 입력. 로컬 수집품은 서버 게시물 식별자를 만들지 않는다. */
export type CollectibleDetailInput = Omit<PublishedCollectible, 'publicationId' | 'projectId'> & {
  frontImageSource?: ImageSourcePropType;
};
export type LegacyCollectibleDetail = CollectibleDetailInput & { merchantName: string };

/** 이미 보유한 기록과 목록에서 선택한 가게 그림만 사용하며 뒷면은 공통 기본 디자인에 맡긴다. */
export function legacyCollectibleDetail(item: UngroupedCollectible, frontImageSource?: ImageSourcePropType): LegacyCollectibleDetail {
  const grade = item.targetVisitCount === 5 ? { gradeId: 'gold', gradeName: '골드' }
    : item.targetVisitCount === 3 ? { gradeId: 'silver', gradeName: '실버' }
      : { gradeId: 'bronze', gradeName: '브론즈' };
  return {
    name: item.displayName || item.campaignTitle, merchantName: item.merchantName, ...grade,
    shape: 'stamp', theme: { name: '가게 방문' }, frontImageSource,
    // 로컬 앞면은 ImageSourcePropType 또는 마스코트로 그리므로 게시물 이미지 필드는 사용하지 않는다.
    imageDataUrl: '', thumbnailDataUrl: '', thickness: 12, angle: 0, animation: 'still',
    greeting: '', audio: null, story: { type: 'none', frames: [], cartoon: 0, strength: 0 },
  };
}
