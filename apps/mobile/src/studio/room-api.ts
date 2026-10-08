import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { consentRequiredMessage, needsConsentRecheck } from '@/privacy/consent-flow';
import { parseAddedFriend } from '@/friends/friends-api';
import { parseFriendStudioSnapshot, type FriendStudioSnapshot } from './studio-api';

export type RoomStampKind = 'COZY' | 'COOL' | 'RETURN';
export type RoomStamp = { id: string; kind: RoomStampKind; createdAt: string; mine: boolean; authorNickname: string; message?: string };
export type RoomVisibility = 'PRIVATE' | 'FRIENDS' | 'PUBLIC' | 'NEIGHBORS';
export type PublicRoom = { roomId: string; mine: boolean; studio: FriendStudioSnapshot; stamps: RoomStamp[];
  visibility: RoomVisibility; sharedMerchants: { merchantId: string; merchantName: string }[];
  visitorCount: number; hasVisited: boolean; returnVisitAvailable: boolean; friendshipId: string | null };
export type RoomVisitor = { nickname: string; visits: number; roomId: string | null; canReturn: boolean };
export type RoomSettings = { visible: boolean; roomId: string | null; visibility: RoomVisibility };
export type RoomVisit = { roomId: string; creditedMileage: number; visitsToday: number };
export type GuestbookEntry = { id: string; roomId: string; message: string; createdAt: string; mine: boolean;
  authorNickname: string; authorAvatar: string | null; authorAvatarClothingId: string | null; unread: boolean };
export type GuestbookPage = { roomId: string | null; entries: GuestbookEntry[]; nextCursor: string | null; unreadCount: number };
export type GuestbookAuthor = { nickname: string; intro: string; avatar: string | null; avatarClothingId: string | null;
  medals: { key: 'explorer' | 'regular' | 'steady'; tier: 0 | 1 | 2 | 3 }[]; earnedBadges: number; totalBadges: 9;
  stampCount: number; friendshipId: string | null; mine: boolean };

const kinds: readonly string[] = ['COZY', 'COOL', 'RETURN'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const visibility = (value: unknown): value is RoomVisibility => ['PRIVATE', 'FRIENDS', 'PUBLIC', 'NEIGHBORS'].includes(value as string);
const nullableString = (value: unknown): value is string | null => value === null || nonempty(value);

export class RoomApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function roomErrorMessage(error: unknown): string {
  if (needsConsentRecheck(error)) return consentRequiredMessage;
  if (error instanceof RoomApiError && error.code === 'ROOM_STAMP_LIMIT') return '이 방에는 오늘 이미 칭찬 도장을 남겼어요. 내일 다시 만나요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_MESSAGE_INVALID') return '글의 길이와 사용할 수 없는 문자가 있는지 확인해 주세요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_GUESTBOOK_MESSAGE_INVALID') return '방명록은 1자 이상 300자 이내로 적어 주세요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_REQUEST_CONFLICT') return '전송한 글을 확인한 뒤 새 글을 남겨 주세요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_GUESTBOOK_NOT_FOUND') return '이 글을 더 이상 볼 수 없어요. 방명록을 다시 불러와 주세요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_CONSENT_REQUIRED') return '방을 공개하려면 최신 개인정보 처리방침에 동의해야 해요.';
  if (error instanceof RoomApiError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND') return '더 이상 이웃으로 연결할 수 없어요. 다른 방을 찾아보세요.';
  if (error instanceof RoomApiError && error.code === 'FRIEND_LIMIT') return '친구 수가 가득 찼어요.';
  if (error instanceof RoomApiError && error.status === 404) return '이 방은 현재 공개되어 있지 않아요. 다른 방을 찾아보세요.';
  if (error instanceof RoomApiError && error.status === 403) return '이 방을 볼 수 없어요. 다른 방을 찾아보세요.';
  if (error instanceof RoomApiError && error.status === 429) return '잠시 후 다시 시도해 주세요.';
  if (error instanceof RoomApiError && error.status === 0) return '연결을 확인하고 다시 시도해 주세요.';
  return '방 정보를 처리하지 못했어요. 다시 시도해 주세요.';
}

export function parseRoomSettings(value: unknown): RoomSettings {
  if (!record(value) || typeof value.visible !== 'boolean' || (value.roomId !== null && !nonempty(value.roomId))) throw new Error('INVALID_ROOM_SETTINGS');
  const scope = value.visibility === undefined ? value.visible ? 'NEIGHBORS' : 'PRIVATE' : value.visibility;
  if (!visibility(scope)) throw new Error('INVALID_ROOM_SETTINGS');
  return { visible: scope !== 'PRIVATE', roomId: value.roomId, visibility: scope };
}

export function parseRoomStamp(value: unknown): RoomStamp {
  if (!record(value) || !nonempty(value.id) || !kinds.includes(value.kind as string) || !nonempty(value.createdAt) || typeof value.mine !== 'boolean') throw new Error('INVALID_ROOM_STAMP');
  if (value.authorNickname !== undefined && !nonempty(value.authorNickname)) throw new Error('INVALID_ROOM_STAMP');
  if (value.message !== undefined && (typeof value.message !== 'string' || !value.message.trim()
    || Array.from(value.message).length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.message))) throw new Error('INVALID_ROOM_STAMP');
  return { id: value.id, kind: value.kind as RoomStampKind, createdAt: value.createdAt, mine: value.mine,
    authorNickname: value.authorNickname ?? '방문자', ...(value.message !== undefined ? { message: value.message } : {}) };
}

export function normalizeRoomMessage(value: string): string | undefined {
  const message = value.trim();
  if (!message) return undefined;
  if (Array.from(message).length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(message)) throw new RoomApiError(400, 'ROOM_MESSAGE_INVALID');
  return message;
}

export function parsePublicRoom(value: unknown): PublicRoom {
  if (!record(value) || !nonempty(value.roomId) || typeof value.mine !== 'boolean' || !Array.isArray(value.stamps)) throw new Error('INVALID_PUBLIC_ROOM');
  const scope = value.visibility === undefined ? 'NEIGHBORS' : value.visibility;
  const shared = value.sharedMerchants === undefined ? [] : value.sharedMerchants;
  if (!visibility(scope) || !Array.isArray(shared) || !shared.every((entry) => record(entry) && nonempty(entry.merchantId) && nonempty(entry.merchantName))
    || (value.visitorCount !== undefined && !count(value.visitorCount)) || (value.hasVisited !== undefined && typeof value.hasVisited !== 'boolean')
    || (value.returnVisitAvailable !== undefined && typeof value.returnVisitAvailable !== 'boolean')
    || (value.friendshipId !== undefined && value.friendshipId !== null && !nonempty(value.friendshipId))) throw new Error('INVALID_PUBLIC_ROOM');
  return { roomId: value.roomId, mine: value.mine, studio: parseFriendStudioSnapshot(value.studio), stamps: value.stamps.map(parseRoomStamp),
    visibility: scope, sharedMerchants: shared.map((entry) => ({ merchantId: entry.merchantId, merchantName: entry.merchantName })),
    visitorCount: value.visitorCount ?? 0, hasVisited: value.hasVisited ?? false, returnVisitAvailable: value.returnVisitAvailable ?? false,
    friendshipId: value.friendshipId ?? null };
}

export function parseRoomVisitors(value: unknown): RoomVisitor[] {
  if (!record(value) || !Array.isArray(value.visitors)) throw new Error('INVALID_ROOM_VISITORS');
  return value.visitors.map((entry: unknown) => {
    if (!record(entry) || !nonempty(entry.nickname) || !count(entry.visits)
      || (entry.roomId !== null && !nonempty(entry.roomId)) || typeof entry.canReturn !== 'boolean') throw new Error('INVALID_ROOM_VISITORS');
    return { nickname: entry.nickname, visits: entry.visits, roomId: entry.roomId, canReturn: entry.canReturn };
  });
}

export function parseRoomVisit(value: unknown): RoomVisit {
  if (!record(value) || !nonempty(value.roomId) || !count(value.creditedMileage) || !count(value.visitsToday)) throw new Error('INVALID_ROOM_VISIT');
  return { roomId: value.roomId, creditedMileage: value.creditedMileage, visitsToday: value.visitsToday };
}

export function normalizeGuestbookMessage(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n');
  const message = normalized.trim();
  if (!message || Array.from(message).length > 300
    || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized.replace(/[\n\t]/g, ''))) throw new RoomApiError(400, 'ROOM_GUESTBOOK_MESSAGE_INVALID');
  return message;
}

export function parseGuestbookEntry(value: unknown): GuestbookEntry {
  if (!record(value) || !nonempty(value.id) || !nonempty(value.roomId) || !nonempty(value.message)
    || !nonempty(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.mine !== 'boolean'
    || !nonempty(value.authorNickname) || !nullableString(value.authorAvatar) || !nullableString(value.authorAvatarClothingId)
    || typeof value.unread !== 'boolean') throw new Error('INVALID_GUESTBOOK_ENTRY');
  normalizeGuestbookMessage(value.message);
  return { id: value.id, roomId: value.roomId, message: value.message, createdAt: value.createdAt, mine: value.mine,
    authorNickname: value.authorNickname, authorAvatar: value.authorAvatar, authorAvatarClothingId: value.authorAvatarClothingId, unread: value.unread };
}

export function parseGuestbookPage(value: unknown): GuestbookPage {
  if (!record(value) || !nullableString(value.roomId) || !Array.isArray(value.entries) || !nullableString(value.nextCursor)
    || !count(value.unreadCount)) throw new Error('INVALID_GUESTBOOK_PAGE');
  const entries = value.entries.map(parseGuestbookEntry);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length || entries.some((entry) => entry.roomId !== value.roomId)) throw new Error('INVALID_GUESTBOOK_PAGE');
  return { roomId: value.roomId, entries, nextCursor: value.nextCursor, unreadCount: value.unreadCount };
}

export function parseGuestbookAuthor(value: unknown): GuestbookAuthor {
  if (!record(value) || !nonempty(value.nickname) || typeof value.intro !== 'string' || !nullableString(value.avatar)
    || !nullableString(value.avatarClothingId) || !nullableString(value.friendshipId) || typeof value.mine !== 'boolean'
    || !count(value.earnedBadges) || value.earnedBadges > 9 || value.totalBadges !== 9 || !count(value.stampCount)
    || !Array.isArray(value.medals) || value.medals.length !== 3) throw new Error('INVALID_GUESTBOOK_AUTHOR');
  const medals = value.medals.map((medal) => {
    if (!record(medal) || !['explorer', 'regular', 'steady'].includes(medal.key as string)
      || ![0, 1, 2, 3].includes(medal.tier as number)) throw new Error('INVALID_GUESTBOOK_AUTHOR');
    return { key: medal.key as GuestbookAuthor['medals'][number]['key'], tier: medal.tier as 0 | 1 | 2 | 3 };
  });
  if (new Set(medals.map((medal) => medal.key)).size !== 3 || medals.reduce((total, medal) => total + medal.tier, 0) !== value.earnedBadges) throw new Error('INVALID_GUESTBOOK_AUTHOR');
  return { nickname: value.nickname, intro: value.intro, avatar: value.avatar, avatarClothingId: value.avatarClothingId,
    medals, earnedBadges: value.earnedBadges, totalBadges: 9, stampCount: value.stampCount, friendshipId: value.friendshipId, mine: value.mine };
}

export function createRoomApiClient(options: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch;
}) {
  const fetcher = options.fetcher ?? fetch;
  const base = options.apiUrl.replace(/\/+$/, '');
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { ...init, headers }); }
    catch { throw new RoomApiError(0, 'NETWORK_ERROR'); }
    let payload: unknown;
    if (response.status !== 204) try { payload = await response.json(); } catch { payload = undefined; }
    if (!response.ok) {
      const code = record(payload) && nonempty(payload.code) ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new RoomApiError(response.status, code);
    }
    return payload;
  }
  const roomPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}`;
  const stampPath = (stampId: string) => `/room-stamps/${encodeURIComponent(stampId)}`;
  const guestbookPath = (entryId: string) => `/room-guestbook/${encodeURIComponent(entryId)}`;
  const pageQuery = (cursor?: string) => cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const json = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    getSettings: async () => parseRoomSettings(await request('/me/room-publication')),
    setVisibility: async (visibility: RoomVisibility) => parseRoomSettings(await request('/me/room-publication', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }),
    })),
    neighbors: async () => {
      const payload = await request('/rooms/neighbors');
      if (!record(payload) || !Array.isArray(payload.rooms)) throw new Error('INVALID_NEIGHBORS');
      return payload.rooms.map(parsePublicRoom);
    },
    visitors: async () => parseRoomVisitors(await request('/me/room-visitors')),
    randomRoom: async (excludeRoomId?: string) => {
      const path = `/rooms/random${excludeRoomId ? `?excludeRoomId=${encodeURIComponent(excludeRoomId)}` : ''}`;
      const payload = await request(path);
      return payload === null ? null : parsePublicRoom(payload);
    },
    getRoom: async (roomId: string) => parsePublicRoom(await request(roomPath(roomId))),
    guestbook: async (roomId: string, cursor?: string) => parseGuestbookPage(await request(`${roomPath(roomId)}/guestbook${pageQuery(cursor)}`)),
    ownGuestbook: async (cursor?: string) => parseGuestbookPage(await request(`/me/room-guestbook${pageQuery(cursor)}`)),
    writeGuestbook: async (roomId: string, requestId: string, message: string) => {
      const payload = await request(`${roomPath(roomId)}/guestbook`, json({ requestId, message: normalizeGuestbookMessage(message) }));
      if (!record(payload) || ![0, 5].includes(payload.creditedMileage as number) || !count(payload.rewardRemainingToday)
        || payload.rewardRemainingToday > 25 || typeof payload.replayed !== 'boolean') throw new Error('INVALID_GUESTBOOK_WRITE');
      return { entry: parseGuestbookEntry(payload.entry), creditedMileage: payload.creditedMileage as number,
        rewardRemainingToday: payload.rewardRemainingToday, replayed: payload.replayed };
    },
    readGuestbook: async (entryIds: string[]) => {
      const payload = await request('/me/room-guestbook/read', json({ entryIds }));
      if (!record(payload) || !count(payload.unreadCount)) throw new Error('INVALID_GUESTBOOK_READ');
      return { unreadCount: payload.unreadCount };
    },
    guestbookAuthor: async (entryId: string) => parseGuestbookAuthor(await request(`${guestbookPath(entryId)}/author`)),
    addGuestbookFriend: async (entryId: string) => parseAddedFriend(await request(`${guestbookPath(entryId)}/friendship`, json({}))),
    removeGuestbook: async (entryId: string) => { await request(guestbookPath(entryId), { method: 'DELETE' }); },
    reportGuestbook: async (entryId: string) => { await request(`${guestbookPath(entryId)}/reports`, json({})); },
    addFriend: async (roomId: string) => parseAddedFriend(await request(`${roomPath(roomId)}/friendship`, json({}))),
    visit: async (roomId: string) => parseRoomVisit(await request(`${roomPath(roomId)}/visits`, json({}))),
    stamp: async (roomId: string, kind: RoomStampKind, message?: string) => {
      const normalized = message === undefined ? undefined : normalizeRoomMessage(message);
      return parseRoomStamp(await request(`${roomPath(roomId)}/stamps`, json({ kind, ...(normalized ? { message: normalized } : {}) })));
    },
    removeStamp: async (stampId: string) => { await request(stampPath(stampId), { method: 'DELETE' }); },
    reportStamp: async (stampId: string) => { await request(`${stampPath(stampId)}/reports`, json({})); },
    blockRoom: async (roomId: string) => { await request(`${roomPath(roomId)}/block`, json({})); },
  };
}
