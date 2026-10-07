import type { FriendStudioSnapshot } from './play.js';

export type RoomStampKind = 'COZY' | 'COOL' | 'RETURN';
export type RoomStamp = { id: string; kind: RoomStampKind; createdAt: string; mine: boolean };
export type PublicRoom = { roomId: string; mine: boolean; studio: FriendStudioSnapshot; stamps: RoomStamp[] };
export type RoomSettings = { visible: boolean; roomId: string | null };
export type RoomVisit = { roomId: string; creditedMileage: number; visitsToday: number };
export type RoomReport = { stampId: string; kind: RoomStampKind; reports: number; firstReportedAt: string };

// Changing this small policy changes the daily reward economy. SQL uniqueness still prevents replay.
export function roomVisitMileageRule(input: { firstVisitToday: boolean; eligible: boolean; creditedRoomsToday: number }): number {
  if (!input.firstVisitToday || !input.eligible) return 0;
  return input.creditedRoomsToday < 5 ? 2 : 0;
}

export interface RoomCommunityService {
  getSettings(accountId: string): Promise<RoomSettings>;
  setVisibility(input: { accountId: string; visible: boolean }): Promise<RoomSettings>;
  randomRoom(input: { accountId: string; excludeRoomId?: string }): Promise<PublicRoom | null>;
  getRoom(input: { accountId: string; roomId: string }): Promise<PublicRoom>;
  visit(input: { accountId: string; roomId: string }): Promise<RoomVisit>;
  stamp(input: { accountId: string; roomId: string; kind: RoomStampKind }): Promise<RoomStamp>;
  removeStamp(input: { accountId: string; stampId: string }): Promise<void>;
  reportStamp(input: { accountId: string; stampId: string }): Promise<void>;
  blockRoom(input: { accountId: string; roomId: string }): Promise<void>;
  listReports(actorAccountId: string): Promise<RoomReport[]>;
  moderateStamp(input: { actorAccountId: string; stampId: string }): Promise<void>;
}

export class RoomCommunityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RoomCommunityError'; }
}
