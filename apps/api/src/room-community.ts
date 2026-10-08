import type { FriendStudioSnapshot } from './play.js';
import type { Medal } from './badge-rules.js';

export type RoomStampKind = 'COZY' | 'COOL' | 'RETURN';
export type RoomVisibility = 'PRIVATE' | 'FRIENDS' | 'NEIGHBORS' | 'PUBLIC';
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
export type GuestbookEntry = { id: string; roomId: string; message: string; createdAt: string; mine: boolean;
  authorNickname: string; authorAvatar: string | null; authorAvatarClothingId: string | null; unread: boolean };
export type GuestbookPage = { roomId: string | null; entries: GuestbookEntry[]; nextCursor: string | null; unreadCount: number };
export type GuestbookAuthor = { nickname: string; intro: string; avatar: string | null; avatarClothingId: string | null;
  medals: Medal[]; earnedBadges: number; totalBadges: number; stampCount: number; friendshipId: string | null; mine: boolean };
export type GuestbookPost = { entry: GuestbookEntry; creditedMileage: number; rewardRemainingToday: number; replayed: boolean };
export type GuestbookReport = { entryId: string; message: string; reports: number; firstReportedAt: string };

export function parseGuestbookMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n/g, '\n');
  if (/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(normalized.replace(/[\n\t]/g, ''))) return null;
  const message = normalized.trim();
  const length = Array.from(message).length;
  return length >= 1 && length <= 300 ? message : null;
}

export function guestbookMileageRule(firstPostToday: boolean, creditedToday: number): number {
  return firstPostToday && creditedToday + 5 <= 25 ? 5 : 0;
}

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
  randomRoom(input: { accountId: string; excludeRoomId?: string; supportsPublic?: boolean }): Promise<PublicRoom | null>;
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
  getGuestbook(input: { accountId: string; roomId: string; cursor?: string }): Promise<GuestbookPage>;
  getMyGuestbook(input: { accountId: string; cursor?: string }): Promise<GuestbookPage>;
  postGuestbook(input: { accountId: string; roomId: string; requestId: string; message: string }): Promise<GuestbookPost>;
  readGuestbook(input: { accountId: string; entryIds: string[] }): Promise<{ unreadCount: number }>;
  getGuestbookAuthor(input: { accountId: string; entryId: string }): Promise<GuestbookAuthor>;
  removeGuestbook(input: { accountId: string; entryId: string }): Promise<void>;
  reportGuestbook(input: { accountId: string; entryId: string }): Promise<void>;
  listGuestbookReports(actorAccountId: string): Promise<GuestbookReport[]>;
  moderateGuestbook(input: { actorAccountId: string; entryId: string }): Promise<void>;
}

export class RoomCommunityError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'RoomCommunityError'; }
}
