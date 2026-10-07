import { EXPERIENCE_COSMETICS, EXPERIENCE_PACKS } from './collection-experience.js';
import type { GradeReward } from './grade-draw.js';
import { MILEAGE_CATALOG, chooseUniform, type MileageGrade } from './mileage-rules.js';

export function catalogRewards(grade: MileageGrade): GradeReward[] {
  const pack = EXPERIENCE_PACKS.find((candidate) => candidate.grade === grade)!;
  return [
    ...MILEAGE_CATALOG.filter((item) => item.grade === grade).map((item) => ({
      kind: 'CHARACTER' as const, id: item.id, name: item.name,
    })),
    ...EXPERIENCE_COSMETICS.filter((item) => item.source.kind === 'pack' && item.source.packId === pack.id)
      .map((item) => ({ kind: 'THEME' as const, id: item.id, name: item.name, slot: item.slot })),
  ];
}

// 공개된 전체 풀의 아이템을 한 번만 균등 추첨한다. 이미 소유한 아이템도 풀에 남는다.
export function chooseGradeReward(rewards: readonly GradeReward[], randomInt: (bound: number) => number): GradeReward {
  return chooseUniform(rewards, randomInt);
}
