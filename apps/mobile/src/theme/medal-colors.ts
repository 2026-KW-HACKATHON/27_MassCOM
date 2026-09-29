// Issue #216 탐험 여권 전용 색. 의미색은 palette.ts가 정본이고, 여기에는 메달 금속색·하늘 여권·잉크 도장처럼
// 수집 화면에서만 쓰는 장식색을 둔다. 대비 기준은 medal-colors.test.ts가 지킨다.

export type TierColors = {
  /** Metallic gradient stops (top-left light → bottom-right shade). */
  highlight: string;
  base: string;
  shade: string;
  /** Outline stroke; ≥3:1 against page background and surface. */
  edge: string;
  /** Tier chip background and its ≥4.5:1 text. */
  container: string;
  onContainer: string;
};

export type MedalColors = {
  bronze: TierColors;
  silver: TierColors;
  gold: TierColors;
  /** Dashed ring for a medal not earned yet. */
  lockedEdge: string;
  lockedFill: string;
  /** Sky passport gradient (top → bottom) and its text colours. */
  sky: readonly [string, string, string];
  skyInk: string;
  skyMuted: string;
  /** "사용 완료" ink stamp, readable on surface, background and the cream ticket. */
  stampInk: string;
  /** Text on a used or expired ticket: quieter than onAccentContainer but still ≥4.5:1 on the cream ticket. */
  ticketMuted: string;
  /** Gift box paper and ribbon. */
  giftPaper: string;
  giftPaperShade: string;
  giftGold: string;
  giftGoldShade: string;
  ribbon: string;
  ribbonShade: string;
  /** Confetti pieces; decorative only. */
  confetti: readonly string[];
};

export const lightMedalColors: MedalColors = {
  bronze: {
    highlight: '#F0B884', base: '#C47A3F', shade: '#8A5226', edge: '#8A5226',
    container: '#F6E6D6', onContainer: '#7A4A1E',
  },
  silver: {
    highlight: '#F4F7FB', base: '#B8C3D0', shade: '#6F7C8C', edge: '#6F7C8C',
    container: '#E8EDF3', onContainer: '#3F4A5A',
  },
  gold: {
    highlight: '#FFE9A0', base: '#E2B33A', shade: '#8F6708', edge: '#8F6708',
    container: '#FBEFC4', onContainer: '#6B4E00',
  },
  lockedEdge: '#7A8595',
  lockedFill: '#EEF1F5',
  sky: ['#BFE3FF', '#E4F3FF', '#F7FBFF'],
  skyInk: '#192331',
  skyMuted: '#3B4A5E',
  stampInk: '#A3401F',
  ticketMuted: '#6B573B',
  giftPaper: '#F7E8C9',
  giftPaperShade: '#E6CFA0',
  giftGold: '#F2C94C',
  giftGoldShade: '#C99A1E',
  ribbon: '#2456D6',
  ribbonShade: '#173A99',
  confetti: ['#2456D6', '#F2C94C', '#6CC08B', '#FF8A65', '#9BB8FF', '#F7E8C9'],
};

export const darkMedalColors: MedalColors = {
  bronze: {
    highlight: '#F3C295', base: '#D08A4E', shade: '#9A5E2E', edge: '#D08A4E',
    container: '#3A2716', onContainer: '#F2C8A0',
  },
  silver: {
    highlight: '#F4F7FB', base: '#B7C2CF', shade: '#7D8A9B', edge: '#B7C2CF',
    container: '#2A313C', onContainer: '#D6DEE8',
  },
  gold: {
    highlight: '#FFEDB0', base: '#E6B93A', shade: '#A77F12', edge: '#E6B93A',
    container: '#3A3012', onContainer: '#F7D774',
  },
  lockedEdge: '#7E8A9A',
  lockedFill: '#262C37',
  sky: ['#1D3A63', '#1A2A45', '#182131'],
  skyInk: '#F3F5F9',
  skyMuted: '#C4D0E0',
  stampInk: '#FFB09A',
  ticketMuted: '#C9B690',
  giftPaper: '#F7E8C9',
  giftPaperShade: '#D9BF8C',
  giftGold: '#F2C94C',
  giftGoldShade: '#C99A1E',
  ribbon: '#4E7BEF',
  ribbonShade: '#2456D6',
  confetti: ['#9BB8FF', '#F2C94C', '#75D6A2', '#FF9F85', '#F7E8C9', '#FFFFFF'],
};

export function medalColorsForScheme(scheme: 'light' | 'dark' | 'unspecified' | null | undefined): MedalColors {
  return scheme === 'dark' ? darkMedalColors : lightMedalColors;
}

export function tierColors(colors: MedalColors, tier: 1 | 2 | 3): TierColors {
  return tier === 1 ? colors.bronze : tier === 2 ? colors.silver : colors.gold;
}
