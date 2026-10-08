import type { CollectibleArtwork } from './collectible-project.js';
import type { CosmeticSlot } from './collection-experience.js';
import type { MileageGrade } from './mileage-rules.js';

export type DrawRarity = MileageGrade | 'PLATINUM';
export type GradeReward =
  | { kind: 'CHARACTER'; id: string; name: string }
  | { kind: 'THEME'; id: string; name: string; slot: CosmeticSlot }
  | { kind: 'COIN'; id: string; name: string; publicationId: string; gradeId: string;
      merchantId: string; merchantName: string; artwork?: CollectibleArtwork }
  | { kind: 'REROLL_TICKET'; id: string; name: string; grade: MileageGrade }
  | { kind: 'MILEAGE'; id: string; name: string; amount: number }
  | { kind: 'FURNITURE'; id: string; name: string; assetId: string | null };
export type DrawCategory = 'REROLL_TICKET' | 'MILEAGE' | 'FURNITURE' | 'THEME';
export type GradeRewardEntry = { rarity: DrawRarity; reward: GradeReward; probability: number };
export type GradeDrawPool = { grade: MileageGrade; price: number; version: string; total: number;
  rewards: GradeRewardEntry[]; gradeWeights: Record<DrawRarity, number>;
  categoryWeightsByRarity: Record<DrawRarity, Record<DrawCategory, number>> };
export type GradeDrawResult = { drawId: string; grade: MileageGrade; price: number; reward: GradeReward;
  rarity: DrawRarity | null; duplicate: boolean; quantity: number; balance: number; replayed: boolean };
export type GradeDrawHistory = Pick<GradeDrawResult, 'drawId' | 'grade' | 'price' | 'reward' | 'rarity'> & { createdAt: string };
export type GradeDrawShop = { balance: number; pools: GradeDrawPool[]; history: GradeDrawHistory[] };
export interface GradeDrawService {
  getShop(accountId: string): Promise<GradeDrawShop>;
  draw(input: { accountId: string; grade: MileageGrade; requestId: string; expectedPoolVersion: string }): Promise<GradeDrawResult>;
}
export class GradeDrawError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'ACCOUNT_DELETED' | 'DRAW_STATE_CHANGED' | 'DRAW_INSUFFICIENT_MILEAGE'
    | 'DRAW_REQUEST_CONFLICT' | 'DRAW_RATE_LIMITED' | 'DRAW_COIN_UNAVAILABLE') { super(code); this.name = 'GradeDrawError'; }
}
