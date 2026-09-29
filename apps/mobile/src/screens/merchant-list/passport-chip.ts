import type { BadgeBook, MedalTier } from '../../gamification/badge-api';
import { tierName } from '../../gamification/badge-rules';

/** Three medals with three tiers each. */
export const MAX_BADGES = 9;

export type PassportChipData = {
  /** Visible chip text, e.g. "배지 3/9". */
  text: string;
  /** Best tier among the medals, for the dot colour; 0 means nothing earned yet, so no dot. */
  tier: MedalTier;
  label: string;
};

/** What the explore passport chip shows once the badge book is loaded; undefined keeps the plain "open my passport" copy. */
export function passportChipData(book: Pick<BadgeBook, 'earnedTiers' | 'medals'> | undefined): PassportChipData | undefined {
  if (!book) return undefined;
  const earned = Math.max(0, Math.min(MAX_BADGES, book.earnedTiers));
  const tier = book.medals.reduce<MedalTier>((best, medal) => (medal.tier > best ? medal.tier : best), 0);
  const base = `내 탐험 여권 보기, 배지 ${MAX_BADGES}개 중 ${earned}개`;
  return {
    text: `배지 ${earned}/${MAX_BADGES}`,
    tier,
    label: tier > 0 ? `${base}, 가장 높은 등급 ${tierName(tier)}` : base,
  };
}
