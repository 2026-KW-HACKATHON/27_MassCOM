import type { CollectibleArtwork } from './collectible-project.js';
import type { GameAction, GameKind, GameSkill, PlayRun } from './play-rules.js';

export type StudioGoal =
  | { kind: 'discover' | 'regular' | 'series'; merchantId: string }
  | { kind: 'collectible'; merchantId: string; campaignId: string; publicationId: string; targetVisitCount: 1 | 3 | 5 }
  | { kind: 'play'; gameKind: GameKind };
export type Studio = {
  theme: 'daylight' | 'evening' | 'garden';
  layout: 'shelf' | 'gallery';
  accent: 'mint' | 'rose' | 'sky';
  slots: string[];
  goal: StudioGoal | null;
  wall?: string | null;
  floor?: string | null;
  furniture?: { inventoryId: string; x: number; y: number; rotation: 0 | 90 | 180 | 270 }[];
  coinSlots?: { sourceKind: 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL'; sourceId: string }[];
};
export type PlayRecord = { kind: GameKind; bestScore: number; plays: number;
  version2BestScore: number; version2Plays: number };
export type StudioItem = {
  entitlementId?: string;
  merchantId: string;
  merchantName: string;
  campaignTitle: string;
  displayName: string;
  artwork?: CollectibleArtwork;
};
export type PlaySnapshot = { records: PlayRecord[]; unlockedThemes: string[]; achievements?: GameSkill[] };
export type CoinDisplayItem = { sourceKind: 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL'; sourceId: string;
  merchantId: string; merchantName: string; publicationId: string; gradeId: string; name: string;
  artwork?: CollectibleArtwork };
export type PlacedFurnitureItem = { id: string; itemId: string; name: string;
  kind: 'FURNITURE'; assetId: string | null };
export type StudioSnapshot = PlaySnapshot & { studio: Studio; revision: number; items: StudioItem[];
  coinItems: CoinDisplayItem[]; furnitureItems: PlacedFurnitureItem[]; avatar: string | null };
export type FriendStudioSnapshot = {
  nickname: string;
  roomId?: string | null;
  studio: Omit<Studio, 'slots' | 'coinSlots'>;
  items: Omit<StudioItem, 'entitlementId'>[];
  coinItems?: Omit<CoinDisplayItem, 'sourceKind' | 'sourceId'>[];
  furnitureItems?: PlacedFurnitureItem[];
  avatar: string | null;
  avatarClothingId?: string | null;
};
export type PlayResult = { kind: GameKind; rulesVersion?: 1 | 2; score: number; bestScore: number; plays: number;
  version2BestScore?: number; version2Plays?: number;
  completed: boolean; correct: number; total: number; unlockedThemes: string[];
  skill?: GameSkill; newlyEarned?: boolean };

export const defaultStudio: Studio = {
  theme: 'daylight', layout: 'shelf', accent: 'mint', slots: [], goal: null,
};

export type PlayEvent = 'share-open' | 'image-created';
export type PlayMetrics = { days: number; events: { event: string; count: number }[];
  games: { kind: GameKind; started: number; completed: number }[] };

export interface PlayService {
  start(input: { accountId: string; kind: GameKind; rulesVersion?: 1 | 2 }): Promise<PlayRun>;
  finish(input: { accountId: string; runId: string; actions: GameAction[] }): Promise<PlayResult>;
  getPlay(accountId: string): Promise<PlaySnapshot>;
  getStudio(accountId: string): Promise<StudioSnapshot>;
  saveStudio(input: { accountId: string; studio: Studio; expectedRevision?: number }): Promise<StudioSnapshot>;
  getFriendStudio(input: { accountId: string; friendshipId: string }): Promise<FriendStudioSnapshot>;
  recordEvent(input: { accountId: string; event: PlayEvent }): Promise<void>;
  aggregate(days: number): Promise<PlayMetrics>;
}

export class PlayError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'PlayError'; }
}
