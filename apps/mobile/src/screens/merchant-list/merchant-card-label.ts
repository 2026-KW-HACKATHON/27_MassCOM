import type { PublicMerchant } from '../../merchant/merchant-api';
import { visitorTagLabels } from '../../merchant/visitor-feedback-codes';

type CardMerchant = Pick<PublicMerchant, 'name' | 'story' | 'roadAddress' | 'demo'> & {
  campaign: Pick<PublicMerchant['campaign'], 'title' | 'enrollmentStatus'>;
  visitorTags?: PublicMerchant['visitorTags'];
};

/** Everything a merchant card shows, in reading order; an empty story is skipped. */
export function merchantCardLabel(merchant: CardMerchant): string {
  // 방문한 사람은 누구나 적립한다(D-023). 참여 정원이 차도 "마감"이라 하지 않는다.
  const topTag = merchant.visitorTags?.[0];
  const tagLabel = topTag ? `${visitorTagLabels[topTag.code]} · ${topTag.count}명` : '';
  return [merchant.name, '참여 가능', merchant.demo ? '데모 데이터' : '', merchant.roadAddress, merchant.story, tagLabel, merchant.campaign.title]
    .filter((part) => part.length > 0)
    .join(', ');
}

/** What tapping the card does; read after the label, so the label itself is all content. */
export function merchantCardHint(): string {
  return '자세히 보기';
}
