import type { FriendStudioSnapshot } from './play.js';

export type RoomStampKind = 'COZY' | 'COOL' | 'RETURN';
export type RoomVisibility = 'PRIVATE' | 'FRIENDS' | 'NEIGHBORS';
export type RoomStamp = { id: string; kind: RoomStampKind; createdAt: string; mine: boolean;
  authorNickname: string; message?: string };
export type PublicRoom = { roomId: string; mine: boolean; visibility: RoomVisibility; studio: FriendStudioSnapshot;
  stamps: RoomStamp[]; sharedMerchants: { merchantId: string; merchantName: string }[];
  visitorCount: number; hasVisited: boolean; returnVisitAvailable: boolean; friendshipId: string | null };
export type RoomVisitor = { nickname: string; visits: number; roomId: string | null; canReturn: boolean };
export type RoomSettings = { visible: boolean; visibility: RoomVisibility; roomId: string | null };
export type RoomVisit = { roomId: string; creditedMileage: number; visitsToday: number };
export type RoomReport = { stampId: string; kind: RoomStampKind; message: string | null;
  reports: number; firstReportedAt: string };

export function parseRoomMessage(value: unknown): string | null {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)) return null;
  const message = value.trim();
  const length = Array.from(message).length;
  return length >= 1 && length <= 120 ? message : null;
}

// Changing this small policy changes the daily reward economy. SQL uniqueness still prevents replay.
export function roomVisitMileageRule(input: { firstVisitToday: boolean; eligible: boolean; creditedRoomsToday: number }): number {
  if (!input.firstVisitToday || !input.eligible) return 0;
  return input.creditedRoomsToday < 5 ? 2 : 0;
}

export interface RoomCommunityService {
  getSettings(accountId: string): Promise<RoomSettings>;
  setVisibility(input: { accountId: string; visible?: boolean; visibility?: RoomVisibility }): Promise<RoomSettings>;
  randomRoom(input: { accountId: string; excludeRoomId?: string }): Promise<PublicRoom | null>;
  neighbors(accountId: string): Promise<PublicRoom[]>;
  visitors(accountId: string): Promise<RoomVisitor[]>;
  getRoom(input: { accountId: string; roomId: string }): Promise<PublicRoom>;
  visit(input: { accountId: string; roomId: string }): Promise<RoomVisit>;
  stamp(input: { accountId: string; roomId: string; kind: RoomStampKind; message?: string }): Promise<RoomStamp>;
  removeStamp(input: { accountId: string; stampId: string }): Promise<void>;
  reportStamp(input: { accountId: string; stampId: string }): Promise<void>;
  blockRoom(input: { accountId: string; roomId: string }): Promise<void>;
  listReports(actorAccountId: string): Promise<RoomReport[]>;
  moderateStamp(input: { actorAccountId: string; stampId: string }): Promise<void>;
}

export class RoomCommunityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RoomCommunityError'; }
}
