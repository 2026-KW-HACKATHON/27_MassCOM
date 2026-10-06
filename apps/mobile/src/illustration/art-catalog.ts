export const cosmeticFrames: Readonly<Record<string, number>> = {
  'explorer-bronze-hat': 0, 'regular-bronze-hat': 1, 'steady-bronze-hat': 2,
  'bronze-hat': 3, 'silver-hat': 4, 'gold-hat': 5,
  'explorer-silver-prop': 6, 'regular-silver-prop': 7, 'steady-silver-prop': 8,
  'memory-card': 9, 'bronze-prop': 10, 'silver-prop': 11, 'gold-prop': 12,
  'courier-bag': 13, 'explorer-gold-decor': 14, 'regular-gold-decor': 15,
  'steady-gold-decor': 16, 'order-sign': 17, 'bronze-decor': 18, 'silver-decor': 19, 'gold-decor': 20,
};
// Cell-edge bleed from neighboring atlas illustrations; fractions preserve each cell's scale and position.
export const cosmeticCrop: Readonly<Record<number, { left?: number; right?: number; top?: number }>> = {
  6: { left: .09 },
  16: { left: .08, top: .04 },
  17: { right: .06, top: .04 },
  18: { top: .04 },
  19: { top: .04 },
  20: { top: .04 },
};
export function badgeFrame(id: string): number | undefined {
  if (id.startsWith('explorer-')) return 0;
  if (id.startsWith('regular-')) return 1;
  if (id.startsWith('steady-')) return 2;
  return ({ 'stack-precision': 3, 'match-efficient': 4, 'delivery-clean': 5, 'order-streak': 6 } as Record<string, number>)[id];
}
export function packFrame(grade: string): number | undefined {
  return ({ bronze: 0, silver: 1, gold: 2 } as Record<string, number>)[grade.toLowerCase()];
}
export type CharacterFrame = 'idle' | 'calm' | 'wave' | 'cheer' | 'joy' | 'concerned' | 0 | 1 | 2 | 3;
export function characterFrame(frame: CharacterFrame): 0 | 1 | 2 | 3 {
  if (typeof frame === 'number') return frame;
  return frame === 'wave' ? 1 : frame === 'cheer' || frame === 'joy' ? 2 : frame === 'concerned' ? 3 : 0;
}
export function equippedFrame(pose: string | null | undefined, reaction: CharacterFrame): 0 | 1 | 2 | 3 {
  const frame = characterFrame(reaction);
  return frame === 0 && pose === 'stack-cheer' ? 2 : frame;
}
