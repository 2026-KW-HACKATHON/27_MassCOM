import type { MileageGrade } from '@/shop/shop-api';

export type GachaPrice = { grade: MileageGrade; price: number; total: number };
export type GachaAvailability = { grade: MileageGrade; price: number; enabled: boolean; reason?: string };

/** Display-only availability. Prices and catalog sizes always come from GET /shop. */
export function gachaAffordability(
  balance: number,
  prices: readonly GachaPrice[],
  ownedByGrade: Partial<Record<MileageGrade, number>>,
): GachaAvailability[] {
  return prices.map(({ grade, price, total }) => {
    if ((ownedByGrade[grade] ?? 0) >= total) return { grade, price, enabled: false, reason: '모두 모았어요' };
    if (balance < price) return { grade, price, enabled: false, reason: `${price - balance}마일리지 부족` };
    return { grade, price, enabled: true };
  });
}

export function isNewDraw(item: { id: string }, ownedBefore: readonly string[]): boolean {
  return !ownedBefore.includes(item.id);
}

export type GachaStage = 'crank' | 'shake' | 'drop' | 'wobble' | 'split' | 'burst' | 'pop';
export type GachaPhase = 'picker' | 'pending' | GachaStage | 'result';
type GachaEvent = { type: 'draw-started' } | { type: 'purchase-failed' } | { type: 'skip'; busy: boolean };

/** 구매 실패는 오류 문구와 독립적으로 선택 상태를 복원한다. */
export function gachaPhaseAfter(phase: GachaPhase, event: GachaEvent): GachaPhase {
  if (event.type === 'draw-started') return 'pending';
  if (event.type === 'purchase-failed') return phase === 'pending' ? 'picker' : phase;
  if (phase === 'pending') return event.busy ? 'pending' : 'picker';
  return phase === 'picker' ? 'picker' : 'result';
}

const stageDurations: Readonly<Record<GachaStage, number>> = {
  crank: 500, shake: 450, drop: 500, wobble: 300, split: 400, burst: 350, pop: 300,
};

export function gachaTimeline(reduceMotion: boolean): Readonly<Record<GachaStage, number>> {
  if (!reduceMotion) return stageDurations;
  return { crank: 0, shake: 0, drop: 0, wobble: 0, split: 0, burst: 0, pop: 0 };
}
