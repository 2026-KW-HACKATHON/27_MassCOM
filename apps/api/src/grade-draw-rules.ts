import { EXPERIENCE_COSMETICS, EXPERIENCE_PACKS } from './collection-experience.js';
import type { DrawCategory, DrawRarity, GradeReward, GradeRewardEntry } from './grade-draw.js';
import { chooseUniform, type MileageGrade } from './mileage-rules.js';

export const gradeWeights: Record<MileageGrade, Record<DrawRarity, number>> = {
  BRONZE: { BRONZE: 8000, SILVER: 1700, GOLD: 280, PLATINUM: 20 },
  SILVER: { BRONZE: 0, SILVER: 9400, GOLD: 550, PLATINUM: 50 },
  GOLD: { BRONZE: 0, SILVER: 0, GOLD: 9900, PLATINUM: 100 },
};
export const categoryWeightsByRarity: Record<DrawRarity, Record<DrawCategory, number>> = {
  BRONZE: { REROLL_TICKET: 50, MILEAGE: 6000, FURNITURE: 2000, THEME: 1950 },
  SILVER: { REROLL_TICKET: 100, MILEAGE: 6000, FURNITURE: 2000, THEME: 1900 },
  GOLD: { REROLL_TICKET: 200, MILEAGE: 6000, FURNITURE: 2000, THEME: 1800 },
  PLATINUM: { REROLL_TICKET: 200, MILEAGE: 6000, FURNITURE: 2000, THEME: 1800 },
};
const mileageAmounts: Record<DrawRarity, number> = { BRONZE: 20, SILVER: 40, GOLD: 80, PLATINUM: 160 };
const rarities = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
const categories = ['REROLL_TICKET', 'MILEAGE', 'FURNITURE', 'THEME'] as const;
export type FurnitureRewardItem = { id: string; name: string; assetId: string | null };

export function catalogRewards(rarity: DrawRarity, furniture: readonly FurnitureRewardItem[] = []): GradeReward[] {
  const packGrade = rarity === 'PLATINUM' ? 'GOLD' : rarity;
  const pack = EXPERIENCE_PACKS.find((candidate) => candidate.grade === packGrade)!;
  const ticketGrade = rarity === 'PLATINUM' ? 'GOLD' : rarity;
  return [
    { kind: 'REROLL_TICKET', id: `reroll-${ticketGrade.toLowerCase()}`, name: `${ticketGrade} 재뽑기권`, grade: ticketGrade },
    { kind: 'MILEAGE', id: `mileage-${rarity.toLowerCase()}`, name: `${mileageAmounts[rarity]}P`, amount: mileageAmounts[rarity] },
    ...furniture.map((item) => ({ kind: 'FURNITURE' as const, id: item.id, name: item.name,
      assetId: item.assetId })),
    ...EXPERIENCE_COSMETICS.filter((item) => item.source.kind === 'pack' && item.source.packId === pack.id)
      .map((item) => ({ kind: 'THEME' as const, id: item.id, name: item.name, slot: item.slot })),
  ];
}

function group(entries: readonly GradeRewardEntry[], rarity: DrawRarity, category: DrawCategory): GradeRewardEntry[] {
  return entries.filter((entry) => entry.rarity === rarity && entry.reward.kind === category);
}

export function rewardEntries(boxGrade: MileageGrade, furniture: readonly FurnitureRewardItem[]): GradeRewardEntry[] {
  if (!furniture.length) throw new RangeError('general box furniture catalog is empty');
  const entries: GradeRewardEntry[] = [];
  for (const rarity of rarities) {
    const rarityWeight = gradeWeights[boxGrade][rarity];
    if (!rarityWeight) continue;
    const rewards = catalogRewards(rarity, furniture);
    for (const category of categories) {
      const eligible = rewards.filter((reward) => reward.kind === category);
      if (!eligible.length) continue;
      const categoryWeight = categoryWeightsByRarity[rarity][category];
      for (const reward of eligible) entries.push({ rarity, reward,
        probability: rarityWeight / 10000 * categoryWeight / 10000 / eligible.length });
    }
  }
  return entries;
}

function weighted<T extends string>(values: readonly T[], weights: Record<T, number>, randomInt: (bound: number) => number): T {
  const total = values.reduce((sum, value) => sum + weights[value], 0);
  const draw = randomInt(total);
  if (!Number.isInteger(draw) || draw < 0 || draw >= total) throw new RangeError('randomInt out of range');
  let remaining = draw;
  for (const value of values) {
    remaining -= weights[value];
    if (remaining < 0) return value;
  }
  throw new RangeError('empty weighted selection');
}

export function chooseGradeReward(entries: readonly GradeRewardEntry[], randomInt: (bound: number) => number): GradeRewardEntry {
  const eligibleRarities = rarities.filter((rarity) => entries.some((entry) => entry.rarity === rarity));
  const rarityWeights = Object.fromEntries(eligibleRarities.map((rarity) =>
    [rarity, Math.round(entries.filter((entry) => entry.rarity === rarity).reduce((sum, entry) => sum + entry.probability, 0) * 10000)])) as Record<DrawRarity, number>;
  const rarity = weighted(eligibleRarities, rarityWeights, randomInt);
  const eligibleCategories = categories.filter((category) => group(entries, rarity, category).length > 0);
  const category = weighted(eligibleCategories, categoryWeightsByRarity[rarity], randomInt);
  return chooseUniform(group(entries, rarity, category), randomInt);
}
