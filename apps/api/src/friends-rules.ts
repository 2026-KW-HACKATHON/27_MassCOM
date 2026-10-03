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

// 별명이 없는 계정에 처음 코드를 만들 때 함께 저장하는 기본 별명이다. 코드와 별개의 난수 4글자를 쓴다. 코드 일부를 그대로
// 쓰면 코드 20비트가 별명으로 새고 코드를 바꿀 때 별명도 바뀌기 때문이다.
export const defaultNicknamePrefix = '탐험가';
const defaultNicknameSuffixLength = 4;

export function generateDefaultNickname(
  random: (size: number) => Uint8Array = randomBytes,
): string {
  const bytes = random(defaultNicknameSuffixLength);
  let suffix = '';
  for (let index = 0; index < defaultNicknameSuffixLength; index++) {
    suffix += friendCodeAlphabet[bytes[index]! & 31];
  }
  return `${defaultNicknamePrefix} ${suffix}`;
}

// 주소·연락처처럼 보이는 별명을 거른다. NFKC로 전각 글자·전각 점을 풀어 놓은 사본에 적용하므로 "ｗｗｗ．ｘ．ｃｏｍ"도 걸린다.
// 도메인 모양은 점 앞이 글자·숫자·하이픈이고 점 뒤가 영문 두 글자 이상이면 모두 거른다("맛집.com", "bit。ly"). 그래서
// TLD 목록을 두지 않는다. "J.K"처럼 점 뒤가 한 글자이거나 점 뒤에 공백·숫자가 오면 통과한다.
const looksLikeAddress = [
  /@/,
  /:\/\//,
  /\b(?:https?|ftp|mailto):/i,
  /\bwww\./i,
  /[\p{L}\p{N}-]+[.。．][a-z]{2,}/iu,
];
// 보이지 않거나 빈 칸처럼 보이는 글자: 제어·서식(Cc·Cf), 줄·문단 구분, 사용자 지정(Co)·미할당(Cn)·짝 없는 서로게이트(Cs)와
// 한글 채움 문자(U+115F·U+1160·U+3164·U+FFA0)·점자 빈칸(U+2800). 채움 문자는 문자(Lo)나 기호(So)라 범주만으로는 안 걸린다.
const invisibleOrControl = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]/u;
const fillerCharacters = new Set(['\u115F', '\u1160', '\u3164', '\uFFA0']);
const letterOrNumber = /[\p{L}\p{N}]/u;
const combiningMark = /\p{M}/u;
const maxMarksPerBase = 2;
const maxMarksTotal = 4;

// 결합 문자(zalgo)를 글자 하나에 두 개, 별명 전체에 네 개까지만 허용한다.
function hasTooManyMarks(text: string): boolean {
  let total = 0;
  let run = 0;
  for (const character of text) {
    if (!combiningMark.test(character)) {
      run = 0;
      continue;
    }
    run++;
    total++;
    if (run > maxMarksPerBase || total > maxMarksTotal) return true;
  }
  return false;
}

// 앞뒤 공백을 지운 별명을 돌려주고, 규칙에 맞지 않으면 null이다. 길이는 DB 제약(char_length)과 같은 코드 포인트 수다.
// 저장하는 값은 원문이고, 금지 규칙은 원문과 NFKC 사본 모두에 적용한다(NFKC가 표식을 합치거나 전각을 풀어 우회를 가리지 못하게).
export function parseNickname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const nickname = input.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > maxNicknameLength) return null;
  const normalized = nickname.normalize('NFKC');
  for (const text of [nickname, normalized]) {
    if (invisibleOrControl.test(text)) return null;
    if (hasTooManyMarks(text)) return null;
  }
  if (looksLikeAddress.some((pattern) => pattern.test(normalized))) return null;
  // 글자나 숫자가 하나도 없거나 채움 문자뿐이면 이름이 보이지 않는다.
  if (!Array.from(normalized).some((character) =>
    letterOrNumber.test(character) && !fillerCharacters.has(character))) return null;
  return nickname;
}

// 친구에게 보이는 메달·도장·순위는 한국 날짜(business_date)가 오늘보다 앞선 방문만 센다(하루 지연). 그래서 방금 다녀온 가게가
// 그날 바로 친구에게 알려지지 않고, 나도 같은 기준으로 순위에 들어가 공정하다. 이 함수는 그 마지막 날짜(= KST 어제)를 준다.
// KST는 일광절약시간이 없어 +9시간 오프셋으로 자정을 자른다.
const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

export function friendsAsOf(now: Date): string {
  const kstToday = Math.floor((now.getTime() + kstOffsetMs) / dayMs);
  return new Date((kstToday - 1) * dayMs).toISOString().slice(0, 10);
}

// friendships의 account_low < account_high 순서는 DB의 "C" 정렬(UTF-8 바이트 순서)과 같아야 한다.
export function orderAccountPair(first: string, second: string): { low: string; high: string } {
  return Buffer.compare(Buffer.from(first), Buffer.from(second)) <= 0
    ? { low: first, high: second }
    : { low: second, high: first };
}

export type FriendMedalView = { key: MedalKind; tier: MedalTier };
export type FriendStampView = { merchantName: string; merchantId: string | null };

// 친구에게 보이는 유일한 모양이다. 여기에 없는 값(계정 ID, 방문 날짜·횟수, 쿠폰, 지갑, 이메일)은 응답에 넣지 않는다.
export type FriendView = {
  friendshipId: string;
  nickname: string;
  badges: { earned: number; total: typeof totalBadges };
  medals: FriendMedalView[];
  stamps: FriendStampView[];
  rank: number;
};

// asOf는 친구 화면의 메달·도장·순위가 "어제까지"의 방문만 센다는 뜻으로, 그 마지막 날짜(한국 날짜, YYYY-MM-DD)다.
export type FriendMeView = {
  nickname: string;
  code: string;
  badges: { earned: number; total: typeof totalBadges };
  medals: FriendMedalView[];
  rank: number;
  asOf: string;
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
  asOf: string;
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
    stamps: source.stamps.map((stamp) => ({ merchantName: stamp.merchantName, merchantId: stamp.merchantId })),
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
    asOf: source.asOf,
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
