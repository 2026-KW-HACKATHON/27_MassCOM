import { MILEAGE_GRADE_PRICES, type MileageGrade } from './mileage-rules.js';
import { medalThresholds, type MedalKind } from './badge-rules.js';
import type { StudioItem } from './play.js';

export const cosmeticSlots = ['hat', 'bag', 'prop', 'pose', 'decor'] as const;
export type CosmeticSlot = (typeof cosmeticSlots)[number];
export type Equipment = Record<CosmeticSlot, string | null>;
export const emptyEquipment = (): Equipment => ({ hat: null, bag: null, prop: null, pose: null, decor: null });

export type ExperienceBadge = { id: string; name: string; kind: 'visit' | 'game'; tier?: 1 | 2 | 3; unlockItemIds: string[] };
export type ExperienceCosmetic = { id: string; name: string; slot: CosmeticSlot;
  source: { kind: 'badge'; badgeId: string } | { kind: 'pack'; packId: string } };
export type ExperiencePack = { id: string; name: string; theme: string; grade: MileageGrade; price: number; bonusItemIds: string[] };

const medalNames: Record<MedalKind, string> = { explorer: '동네 탐험', regular: '단골 발걸음', steady: '꾸준한 산책' };
const tiers = ['bronze', 'silver', 'gold'] as const;
export const EXPERIENCE_BADGES: readonly ExperienceBadge[] = [
  ...(['explorer', 'regular', 'steady'] as const).flatMap((kind) => tiers.map((tier, index) => ({
    id: `${kind}-${tier}`, name: `${medalNames[kind]} ${['동', '은', '금'][index]}`, kind: 'visit' as const,
    tier: (index + 1) as 1 | 2 | 3, unlockItemIds: [`${kind}-${tier}-${index === 0 ? 'hat' : index === 1 ? 'prop' : 'decor'}`],
  }))),
  { id: 'stack-precision', name: '균형의 달인', kind: 'game', unlockItemIds: ['stack-cheer'] },
  { id: 'match-efficient', name: '기억의 달인', kind: 'game', unlockItemIds: ['memory-card'] },
  { id: 'delivery-clean', name: '배달의 달인', kind: 'game', unlockItemIds: ['courier-bag'] },
  { id: 'order-streak', name: '주문 박사', kind: 'game', unlockItemIds: ['order-sign'] },
];

export const EXPERIENCE_PACKS: readonly ExperiencePack[] = (['BRONZE', 'SILVER', 'GOLD'] as const).map((grade) => {
  const theme = grade === 'BRONZE' ? '카페 산책' : grade === 'SILVER' ? '빵집 골목' : '밤시장 탐험';
  const id = grade.toLowerCase();
  return { id, name: `${theme} 팩`, theme, grade, price: MILEAGE_GRADE_PRICES[grade],
    bonusItemIds: [`${id}-hat`, `${id}-prop`, `${id}-decor`] };
});

const badgeCosmetics: ExperienceCosmetic[] = EXPERIENCE_BADGES.flatMap((badge) => badge.unlockItemIds.map((id) => ({
  id, name: badge.name + (id === 'memory-card' ? ' 카드 소품' : id.endsWith('-hat') ? ' 모자' : id.endsWith('-prop') ? ' 소품' : id.endsWith('-decor') || id === 'order-sign' ? ' 장식' : id === 'courier-bag' ? ' 가방' : ' 포즈'),
  slot: (id.endsWith('-hat') ? 'hat' : id.endsWith('-prop') || id === 'memory-card' ? 'prop' :
    id.endsWith('-decor') || id === 'order-sign' ? 'decor' : id === 'courier-bag' ? 'bag' : 'pose') as CosmeticSlot,
  source: { kind: 'badge', badgeId: badge.id },
})));
const packCosmetics: ExperienceCosmetic[] = EXPERIENCE_PACKS.flatMap((pack) => pack.bonusItemIds.map((id) => ({
  id, name: `${pack.theme} ${id.endsWith('hat') ? '모자' : id.endsWith('prop') ? '소품' : '장식'}`,
  slot: (id.endsWith('hat') ? 'hat' : id.endsWith('prop') ? 'prop' : 'decor') as CosmeticSlot,
  source: { kind: 'pack', packId: pack.id },
})));
export const EXPERIENCE_COSMETICS: readonly ExperienceCosmetic[] = [...badgeCosmetics, ...packCosmetics];

// Account lifecycle locking serializes draws; the ledger records this selection for replay.
export function nextCosmeticBonus(grade: MileageGrade, owned: ReadonlySet<string>): string {
  const pack = EXPERIENCE_PACKS.find((candidate) => candidate.grade === grade)!;
  const id = pack.bonusItemIds.find((candidate) => !owned.has(candidate));
  if (!id) throw new Error(`cosmetic pack already complete: ${grade}`);
  return id;
}

export function badgeTarget(id: string): number {
  const match = /^(explorer|regular|steady)-(bronze|silver|gold)$/.exec(id);
  if (!match) return 1;
  return medalThresholds[match[1] as MedalKind][tiers.indexOf(match[2] as typeof tiers[number])]!;
}

export type ExperienceCoinSource = { sourceKind: 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL'; sourceId: string };
export type PublicRepresentativeCoin = Pick<StudioItem, 'merchantId' | 'merchantName' | 'campaignTitle' | 'displayName' | 'artwork'>;
export type ExperienceProfile = { badgeId: string | null; cosmetics: Equipment; coinEntitlementId: string | null;
  coinSource: ExperienceCoinSource | null; representativeCoin: PublicRepresentativeCoin | null; wishlist: string | null };
export type PublicExperienceProfile = {
  badgeId: string | null;
  badgeName: string | null;
  cosmetics: Equipment;
  coin: PublicRepresentativeCoin | null;
};
export type ExperienceSnapshot = {
  catalog: { badges: readonly ExperienceBadge[]; cosmetics: readonly ExperienceCosmetic[]; packs: readonly ExperiencePack[] };
  profile: ExperienceProfile;
  progress: {
    badges: { id: string; value: number; target: number; owned: boolean; nextAction: string }[];
    cosmetics: { id: string; owned: boolean; equippable: boolean }[];
    packs: { id: string; opens: number; ownedBonuses: number; totalBonuses: number }[];
  };
};
export class ExperienceError extends Error {
  constructor(readonly code: 'EXPERIENCE_INVALID' | 'EXPERIENCE_LOCKED' | 'EXPERIENCE_FRIEND_NOT_FOUND' | 'ACCOUNT_DELETED') {
    super(code); this.name = 'ExperienceError';
  }
}
export interface CollectionExperienceService {
  getSnapshot(accountId: string): Promise<ExperienceSnapshot>;
  setEquipment(input: { accountId: string; badgeId?: string | null; cosmetics?: Partial<Equipment>;
    coinEntitlementId?: string | null; coinSource?: ExperienceCoinSource | null }): Promise<ExperienceSnapshot>;
  setWishlist(input: { accountId: string; itemId: string | null }): Promise<ExperienceSnapshot>;
  getFriend(input: { accountId: string; friendshipId: string }): Promise<PublicExperienceProfile>;
}
