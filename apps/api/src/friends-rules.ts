// 친구 규칙(Issue #230, D-047). 코드·별명·순위와 "친구에게 보이는 항목"의 허용 목록 직렬화를 DB 없이 시험할 수 있는
// 순수 함수로만 둔다. 메달·배지 규칙은 badge-rules.ts를 그대로 쓴다.
import { randomBytes } from 'node:crypto';

import { earnedTiers, type Medal, type MedalKind, type MedalTier } from './badge-rules.js';

// 0·O·1·I가 없는 32글자. 32는 2의 거듭제곱이라 바이트 하나의 하위 5비트로 고르면 치우침이 없다.
export const friendCodeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const friendCodeLength = 8;
export const friendCodePattern = /^[2-9A-HJ-NP-Z]{8}$/;
export const maxFriends = 100;
export const totalBadges = 9;
export const maxNicknameLength = 12;

export function generateFriendCode(
  random: (size: number) => Uint8Array = randomBytes,
): string {
  const bytes = random(friendCodeLength);
  let code = '';
  for (let index = 0; index < friendCodeLength; index++) {
    code += friendCodeAlphabet[bytes[index]! & 31];
  }
  return code;
}

// 사람이 입력·붙여넣기한 코드를 저장 형식으로 맞춘다: 대문자로 바꾸고 공백·하이픈류를 지운다.
export function normalizeFriendCode(input: string): string {
  return input.toUpperCase().replace(/[\s\-‐-―−－]/g, '');
}

export function isFriendCode(code: string): boolean {
  return friendCodePattern.test(code);
}

export function defaultNickname(code: string): string {
  return `탐험가 ${code.slice(-4)}`;
}

const looksLikeAddress = [
  /@/,
  /:\/\//,
  /\b(?:https?|ftp|mailto):/i,
  /\bwww\./i,
  /[a-z0-9-]\.(?:com|net|org|kr|io|co|me|app|dev|xyz|info|biz|edu|gov|ly|gg|tv|link|site|online|shop|store|cc|us|jp|cn|uk|de|fr|ru)(?![a-z0-9])/i,
];
const invisibleOrControl = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

// 앞뒤 공백을 지운 별명을 돌려주고, 규칙에 맞지 않으면 null이다. 길이는 DB 제약(char_length)과 같은 코드 포인트 수다.
export function parseNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const nickname = input.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > maxNicknameLength) return null;
  if (invisibleOrControl.test(nickname)) return null;
  if (looksLikeAddress.some((pattern) => pattern.test(nickname))) return null;
  return nickname;
}

// friendships의 account_low < account_high 순서는 DB의 "C" 정렬(UTF-8 바이트 순서)과 같아야 한다.
export function orderAccountPair(first: string, second: string): { low: string; high: string } {
  return Buffer.compare(Buffer.from(first), Buffer.from(second)) <= 0
    ? { low: first, high: second }
    : { low: second, high: first };
}

export type FriendMedalView = { key: MedalKind; tier: MedalTier };
export type FriendStampView = { merchantName: string };

// 친구에게 보이는 유일한 모양이다. 여기에 없는 값(계정 ID, 방문 날짜·횟수, 쿠폰, 지갑, 이메일)은 응답에 넣지 않는다.
export type FriendView = {
  friendshipId: string;
  nickname: string;
  badges: { earned: number; total: typeof totalBadges };
  medals: FriendMedalView[];
  stamps: FriendStampView[];
  rank: number;
};

export type FriendMeView = {
  nickname: string;
  code: string;
  badges: { earned: number; total: typeof totalBadges };
  medals: FriendMedalView[];
  rank: number;
};

export type FriendsSnapshot = { me: FriendMeView; friends: FriendView[] };

// 서비스가 DB에서 모은 원본. 직렬화 함수가 이 중 허용 필드만 고르므로 여분의 값이 섞여 있어도 응답에는 나가지 않는다.
export type FriendSource = {
  friendshipId: string;
  nickname: string;
  medals: readonly Medal[];
  stamps: readonly FriendStampView[];
};

export type FriendMeSource = {
  nickname: string;
  code: string;
  medals: readonly Medal[];
  stampCount: number;
};

function badgesOf(medals: readonly Medal[]): { earned: number; total: typeof totalBadges } {
  return { earned: earnedTiers(medals), total: totalBadges };
}

function medalsOf(medals: readonly Medal[]): FriendMedalView[] {
  return medals.map((medal) => ({ key: medal.kind, tier: medal.tier }));
}

export function serializeFriendView(source: FriendSource, rank: number): FriendView {
  return {
    friendshipId: source.friendshipId,
    nickname: source.nickname,
    badges: badgesOf(source.medals),
    medals: medalsOf(source.medals),
    stamps: source.stamps.map((stamp) => ({ merchantName: stamp.merchantName })),
    rank,
  };
}

export function serializeFriendMeView(source: FriendMeSource, rank: number): FriendMeView {
  return {
    nickname: source.nickname,
    code: source.code,
    badges: badgesOf(source.medals),
    medals: medalsOf(source.medals),
    rank,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// 순위: 배지 수 내림차순 → 도장 수 내림차순 → 별명 → (동률 방지) 고정 키. 나도 순위에 들어간다.
export function buildFriendsSnapshot(
  me: FriendMeSource,
  friends: readonly FriendSource[],
): FriendsSnapshot {
  const entries = [
    { key: '0', badges: earnedTiers(me.medals), stampCount: me.stampCount, nickname: me.nickname,
      friend: null as FriendSource | null },
    ...friends.map((friend) => ({
      key: `1:${friend.friendshipId}`, badges: earnedTiers(friend.medals),
      stampCount: friend.stamps.length, nickname: friend.nickname, friend,
    })),
  ].sort((left, right) =>
    right.badges - left.badges
    || right.stampCount - left.stampCount
    || compareText(left.nickname, right.nickname)
    || compareText(left.key, right.key));

  let meView: FriendMeView | undefined;
  const friendViews: FriendView[] = [];
  entries.forEach((entry, index) => {
    const rank = index + 1;
    if (entry.friend) friendViews.push(serializeFriendView(entry.friend, rank));
    else meView = serializeFriendMeView(me, rank);
  });
  return { me: meView!, friends: friendViews };
}
