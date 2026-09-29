import type { PublicMerchant } from '../../merchant/merchant-api';

type CardMerchant = Pick<PublicMerchant, 'name' | 'story' | 'roadAddress' | 'demo'> & {
  campaign: Pick<PublicMerchant['campaign'], 'title' | 'enrollmentStatus'>;
};

/** Everything a merchant card shows, in reading order; an empty story is skipped. */
export function merchantCardLabel(merchant: CardMerchant): string {
  const status = merchant.campaign.enrollmentStatus === 'OPEN' ? '참여 가능' : '정원 마감';
  return [merchant.name, status, merchant.demo ? '데모 데이터' : '', merchant.roadAddress, merchant.story, merchant.campaign.title]
    .filter((part) => part.length > 0)
    .join(', ');
}

/** What tapping the card does; read after the label, so the label itself is all content. */
export function merchantCardHint(): string {
  return '자세히 보기';
}
