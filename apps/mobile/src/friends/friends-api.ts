import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { medalKinds, type MedalKind, type MedalTier } from '@/gamification/badge-api';

import { validateFriendCode } from './code';

// Issue #230 친구 계약(apps/api/README.md, docs/superpowers/specs/2026-09-29-friends-design.md §3).
// 서버가 정본이며, 앱은 형식이 어긋난 응답을 보여 주지 않고 거절한다. 친구 항목은 허용된 필드만 골라 담아 서버가 실수로 더 보내도
// 화면과 상태에 남지 않는다.

export const TOTAL_BADGES = 9;
export const MAX_NICKNAME_LENGTH = 12;
/** Shown for a stamp whose shop name came back blank. */
export const UNNAMED_SHOP = '이름 없는 가게';

export type FriendMedal = { key: MedalKind; tier: MedalTier };
export type FriendBadges = { earned: number; total: typeof TOTAL_BADGES };
export type FriendStamp = { merchantName: string };

export type Friend = {
  friendshipId: string;
  nickname: string;
  badges: FriendBadges;
  /** Always explorer, regular, steady in this order. */
  medals: readonly FriendMedal[];
  stamps: readonly FriendStamp[];
  rank: number;
};

export type FriendMe = {
  nickname: string;
  code: string;
  badges: FriendBadges;
  medals: readonly FriendMedal[];
  rank: number;
  /** The last Korean date the friend numbers count (yesterday), YYYY-MM-DD. */
  asOf: string;
};

export type FriendsSnapshot = { me: FriendMe; friends: readonly Friend[] };
export type AddedFriend = { friend: Friend; created: boolean };

export class FriendsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'FriendsApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type FriendsApiClient = ReturnType<typeof createFriendsApiClient>;

const friendshipIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxRetryAfterSeconds = 24 * 60 * 60;

export function createFriendsApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new FriendsApiError(0, 'NETWORK_ERROR');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new FriendsApiError(
        response.status,
        code,
        response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
      );
    }
    return payload;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    async getFriends(): Promise<FriendsSnapshot> {
      return parseFriendsSnapshot(await request('/me/friends'));
    },

    /** The code travels in the JSON body only, never in a URL. */
    async addFriend(input: string): Promise<AddedFriend> {
      const checked = validateFriendCode(input);
      // The server answers a malformed code exactly like an unknown one (and counts it as a failed try), so skip the request.
      if (!checked.ok) throw new FriendsApiError(404, 'FRIEND_CODE_NOT_FOUND');
      return parseAddedFriend(await request('/me/friends', json('POST', { code: checked.code })));
    },

    async removeFriend(friendshipId: string): Promise<void> {
      if (!friendshipIdPattern.test(friendshipId)) throw new FriendsApiError(404, 'FRIEND_NOT_FOUND');
      const payload = await request(`/me/friends/${friendshipId}`, { method: 'DELETE' });
      if (!isRecord(payload) || payload.status !== 'REMOVED') throw invalidResponse();
    },

    async rotateCode(): Promise<string> {
      const payload = await request('/me/friend-code/rotate', json('POST', {}));
      if (!isRecord(payload)) throw invalidResponse();
      return parseCode(payload.code);
    },

    async setNickname(nickname: string): Promise<string> {
      const payload = await request('/me/profile', json('PUT', { nickname }));
      if (!isRecord(payload)) throw invalidResponse();
      return parseNickname(payload.nickname);
    },
  };
}

export function parseFriendsSnapshot(value: unknown): FriendsSnapshot {
  if (!isRecord(value) || !Array.isArray(value.friends)) throw invalidResponse();
  const me = parseMe(value.me);
  const friends = value.friends.map(parseFriend);
  const ids = new Set(friends.map((friend) => friend.friendshipId));
  if (ids.size !== friends.length) throw invalidResponse();
  // The server ranks me and every friend together: exactly the places 1..n, each once.
  const ranks = [me.rank, ...friends.map((friend) => friend.rank)].sort((left, right) => left - right);
  if (!ranks.every((rank, index) => rank === index + 1)) throw invalidResponse();
  return { me, friends };
}

export function parseAddedFriend(value: unknown): AddedFriend {
  if (!isRecord(value) || typeof value.created !== 'boolean') throw invalidResponse();
  return { friend: parseFriend(value.friend), created: value.created };
}

function parseMe(value: unknown): FriendMe {
  if (!isRecord(value)) throw invalidResponse();
  const medals = parseMedals(value.medals);
  return {
    nickname: parseNickname(value.nickname),
    code: parseCode(value.code),
    badges: parseBadges(value.badges, medals),
    medals,
    rank: parseRank(value.rank),
    asOf: parseAsOf(value.asOf),
  };
}

function parseFriend(value: unknown): Friend {
  if (!isRecord(value) || typeof value.friendshipId !== 'string' || !friendshipIdPattern.test(value.friendshipId)) {
    throw invalidResponse();
  }
  const medals = parseMedals(value.medals);
  return {
    friendshipId: value.friendshipId,
    nickname: parseNickname(value.nickname),
    badges: parseBadges(value.badges, medals),
    medals,
    stamps: parseStamps(value.stamps),
    rank: parseRank(value.rank),
  };
}

function parseCode(value: unknown): string {
  const checked = typeof value === 'string' ? validateFriendCode(value) : undefined;
  // The server only sends canonical codes, so a code that needed normalising is not one of ours.
  if (!checked?.ok || checked.code !== value) throw invalidResponse();
  return checked.code;
}

function parseNickname(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw invalidResponse();
  if (Array.from(value).length > MAX_NICKNAME_LENGTH) throw invalidResponse();
  return value;
}

function parseMedals(value: unknown): FriendMedal[] {
  if (!Array.isArray(value) || value.length !== medalKinds.length) throw invalidResponse();
  const parsed = value.map((medal): FriendMedal => {
    if (!isRecord(medal) || !isMedalKind(medal.key) || !isTier(medal.tier)) throw invalidResponse();
    return { key: medal.key, tier: medal.tier };
  });
  return medalKinds.map((kind) => {
    const matches = parsed.filter((medal) => medal.key === kind);
    if (matches.length !== 1) throw invalidResponse();
    return matches[0]!;
  });
}

function parseBadges(value: unknown, medals: readonly FriendMedal[]): FriendBadges {
  if (!isRecord(value) || value.total !== TOTAL_BADGES || !Number.isInteger(value.earned)) throw invalidResponse();
  const earned = value.earned as number;
  if (earned < 0 || earned > TOTAL_BADGES) throw invalidResponse();
  if (earned !== medals.reduce((sum, medal) => sum + medal.tier, 0)) throw invalidResponse();
  return { earned, total: TOTAL_BADGES };
}

function parseStamps(value: unknown): FriendStamp[] {
  if (!Array.isArray(value)) throw invalidResponse();
  return value.map((stamp): FriendStamp => {
    if (!isRecord(stamp) || typeof stamp.merchantName !== 'string') throw invalidResponse();
    // One shop whose name is blank (spaces of any width included) must not hide the friend's whole passport.
    return { merchantName: stamp.merchantName.trim().length === 0 ? UNNAMED_SHOP : stamp.merchantName };
  });
}

function parseRank(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw invalidResponse();
  return value as number;
}

function parseAsOf(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidResponse();
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw invalidResponse();
  return value;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Math.min(maxRetryAfterSeconds, Math.max(1, Number(header.trim())));
}

function isMedalKind(value: unknown): value is MedalKind {
  return (medalKinds as readonly unknown[]).includes(value);
}

function isTier(value: unknown): value is MedalTier {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): FriendsApiError {
  return new FriendsApiError(200, 'INVALID_RESPONSE');
}

/**
 * A change the server accepted may still reach the app as a reply it refuses to read (INVALID_RESPONSE). The screen then has
 * to reload, or it would keep showing the old nickname or code.
 */
export function replyNeedsRefresh(error: unknown): boolean {
  return error instanceof FriendsApiError && error.code === 'INVALID_RESPONSE';
}

/** Plain Korean for what a person can hit; a raw code or status never reaches the screen. */
export function friendsErrorMessage(error: unknown): string {
  if (!(error instanceof FriendsApiError)) return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
  switch (error.code) {
    case 'FRIEND_CODE_NOT_FOUND':
      // An unknown code and one from someone who ended the friendship read the same on purpose.
      return '코드를 찾지 못했어요. 글자를 다시 확인하거나 친구에게 새 코드를 받아 보세요.';
    case 'FRIEND_SELF':
      return '내 코드예요. 친구의 코드를 입력해 주세요.';
    case 'FRIEND_LIMIT':
      return '친구가 가득 차서 더 추가할 수 없어요. 한 사람당 최대 100명까지예요.';
    case 'FRIEND_CODE_RATE_LIMITED':
      return error.retryAfterSeconds === undefined
        ? '잠시 후 다시 시도해 주세요'
        : `잠시 후 다시 시도해 주세요 (${Math.max(1, Math.ceil(error.retryAfterSeconds / 60))}분)`;
    case 'ACCOUNT_DELETED':
      return '삭제된 계정이라 친구 기능을 쓸 수 없어요.';
    case 'FRIEND_NICKNAME_INVALID':
      return '이 별명은 쓸 수 없어요. 글자나 숫자가 들어간 12자 이하로, 주소나 이메일처럼 보이지 않게 지어 주세요.';
    case 'FRIEND_NOT_FOUND':
      return '이미 끊어진 친구예요. 목록을 새로 불러올게요.';
    case 'FRIENDS_NOT_CONFIGURED':
      return '친구 기능이 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요.';
    case 'SESSION_INVALID':
      return '로그인이 만료됐어요. 다시 로그인해 주세요.';
    case 'NETWORK_ERROR':
      return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
    case 'INVALID_RESPONSE':
      return '서버 응답을 확인하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
    default:
      return '요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }
}
