import type { CollectibleArtwork } from './collectible-project.js';
import type { GameAction, GameKind, GameSkill, PlayRun } from './play-rules.js';

export type StudioGoal =
  | { kind: 'discover' | 'regular' | 'series'; merchantId: string }
  | { kind: 'play'; gameKind: GameKind };
export type Studio = {
  theme: 'daylight' | 'evening' | 'garden';
  layout: 'shelf' | 'gallery';
  accent: 'mint' | 'rose' | 'sky';
  slots: string[];
  goal: StudioGoal | null;
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
export type StudioSnapshot = PlaySnapshot & { studio: Studio; items: StudioItem[]; avatar: string | null };
export type FriendStudioSnapshot = {
  nickname: string;
  studio: Omit<Studio, 'slots'>;
  items: Omit<StudioItem, 'entitlementId'>[];
  avatar: string | null;
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
  start(input: { accountId: string; kind: GameKind }): Promise<PlayRun>;
  finish(input: { accountId: string; runId: string; actions: GameAction[] }): Promise<PlayResult>;
  getPlay(accountId: string): Promise<PlaySnapshot>;
  getStudio(accountId: string): Promise<StudioSnapshot>;
  saveStudio(input: { accountId: string; studio: Studio }): Promise<StudioSnapshot>;
  getFriendStudio(input: { accountId: string; friendshipId: string }): Promise<FriendStudioSnapshot>;
  recordEvent(input: { accountId: string; event: PlayEvent }): Promise<void>;
  aggregate(days: number): Promise<PlayMetrics>;
}

export class PlayError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'PlayError'; }
}
