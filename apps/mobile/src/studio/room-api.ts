import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { consentRequiredMessage, needsConsentRecheck } from '@/privacy/consent-flow';
import { parseFriendStudioSnapshot, type FriendStudioSnapshot } from './studio-api';

export type RoomStampKind = 'COZY' | 'COOL' | 'RETURN';
export type RoomStamp = { id: string; kind: RoomStampKind; createdAt: string; mine: boolean };
export type PublicRoom = { roomId: string; mine: boolean; studio: FriendStudioSnapshot; stamps: RoomStamp[] };
export type RoomSettings = { visible: boolean; roomId: string | null };
export type RoomVisit = { roomId: string; creditedMileage: number; visitsToday: number };

const kinds: readonly string[] = ['COZY', 'COOL', 'RETURN'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export class RoomApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export function roomErrorMessage(error: unknown): string {
  if (needsConsentRecheck(error)) return consentRequiredMessage;
  if (error instanceof RoomApiError && error.code === 'ROOM_STAMP_LIMIT') return '이 방에는 오늘 이미 칭찬 도장을 남겼어요. 내일 다시 만나요.';
  if (error instanceof RoomApiError && error.code === 'ROOM_CONSENT_REQUIRED') return '방을 공개하려면 최신 개인정보 처리방침에 동의해야 해요.';
  if (error instanceof RoomApiError && error.status === 404) return '이 방은 현재 공개되어 있지 않아요. 다른 방을 찾아보세요.';
  if (error instanceof RoomApiError && error.status === 403) return '이 방을 볼 수 없어요. 다른 방을 찾아보세요.';
  if (error instanceof RoomApiError && error.status === 429) return '잠시 후 다시 시도해 주세요.';
  if (error instanceof RoomApiError && error.status === 0) return '연결을 확인하고 다시 시도해 주세요.';
  return '방 정보를 처리하지 못했어요. 다시 시도해 주세요.';
}

export function parseRoomSettings(value: unknown): RoomSettings {
  if (!record(value) || typeof value.visible !== 'boolean' || (value.roomId !== null && !nonempty(value.roomId))) throw new Error('INVALID_ROOM_SETTINGS');
  return { visible: value.visible, roomId: value.roomId };
}

export function parseRoomStamp(value: unknown): RoomStamp {
  if (!record(value) || !nonempty(value.id) || !kinds.includes(value.kind as string) || !nonempty(value.createdAt) || typeof value.mine !== 'boolean') throw new Error('INVALID_ROOM_STAMP');
  return { id: value.id, kind: value.kind as RoomStampKind, createdAt: value.createdAt, mine: value.mine };
}

export function parsePublicRoom(value: unknown): PublicRoom {
  if (!record(value) || !nonempty(value.roomId) || typeof value.mine !== 'boolean' || !Array.isArray(value.stamps)) throw new Error('INVALID_PUBLIC_ROOM');
  return { roomId: value.roomId, mine: value.mine, studio: parseFriendStudioSnapshot(value.studio), stamps: value.stamps.map(parseRoomStamp) };
}

export function parseRoomVisit(value: unknown): RoomVisit {
  if (!record(value) || !nonempty(value.roomId) || !count(value.creditedMileage) || !count(value.visitsToday)) throw new Error('INVALID_ROOM_VISIT');
  return { roomId: value.roomId, creditedMileage: value.creditedMileage, visitsToday: value.visitsToday };
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
  const json = (body: object): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return {
    getSettings: async () => parseRoomSettings(await request('/me/room-publication')),
    setVisibility: async (visible: boolean) => parseRoomSettings(await request('/me/room-publication', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible }),
    })),
    randomRoom: async (excludeRoomId?: string) => {
      const path = `/rooms/random${excludeRoomId ? `?excludeRoomId=${encodeURIComponent(excludeRoomId)}` : ''}`;
      const payload = await request(path);
      return payload === null ? null : parsePublicRoom(payload);
    },
    getRoom: async (roomId: string) => parsePublicRoom(await request(roomPath(roomId))),
    visit: async (roomId: string) => parseRoomVisit(await request(`${roomPath(roomId)}/visits`, json({}))),
    stamp: async (roomId: string, kind: RoomStampKind) => parseRoomStamp(await request(`${roomPath(roomId)}/stamps`, json({ kind }))),
    removeStamp: async (stampId: string) => { await request(stampPath(stampId), { method: 'DELETE' }); },
    reportStamp: async (stampId: string) => { await request(`${stampPath(stampId)}/reports`, json({})); },
    blockRoom: async (roomId: string) => { await request(`${roomPath(roomId)}/block`, json({})); },
  };
}
