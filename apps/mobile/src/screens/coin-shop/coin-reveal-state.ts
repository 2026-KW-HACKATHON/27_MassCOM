export type CoinRevealStage = 'source' | 'opening' | 'result';
export type CoinRevealEvent = 'open' | 'settle' | 'skip';

/** Presentation only: no transition consumes a ticket or dismisses a result. */
export function nextCoinRevealStage(stage: CoinRevealStage, event: CoinRevealEvent): CoinRevealStage {
  if (event === 'skip') return 'result';
  if (stage === 'source' && event === 'open') return 'opening';
  if (stage === 'opening' && event === 'settle') return 'result';
  return stage;
}

/** Published grade identity controls the effect, never ticket price or guessed odds. */
export function coinRevealAccent(gradeId: string) {
  switch (gradeId) {
    case 'prism': return { label: '프리즘', duration: 1100, scale: 1.12, rings: 3 };
    case 'gold': return { label: '골드', duration: 900, scale: 1.08, rings: 2 };
    case 'silver': return { label: '실버', duration: 700, scale: 1.04, rings: 1 };
    case 'bronze': return { label: '브론즈', duration: 500, scale: 1, rings: 1 };
    default: return { label: '가게 코인', duration: 500, scale: 1, rings: 1 };
  }
}
