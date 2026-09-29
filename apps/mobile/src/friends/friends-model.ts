import { medalCopy, tierName } from '@/gamification/badge-rules';

import { MAX_NICKNAME_LENGTH, type FriendBadges, type FriendMedal, type FriendsSnapshot } from './friends-api';

export type RankingRow = {
  /** A stable list key: the friendship id, or "me". */
  key: string;
  rank: number;
  nickname: string;
  badges: FriendBadges;
  medals: readonly FriendMedal[];
  isMe: boolean;
  /** Absent on my own row; a friend's row opens that friend's passport with it. */
  friendshipId?: string;
};

/** Me and my friends in one list, in the order the server ranked them (badges, then stamps, then nickname). */
export function buildRankingRows(snapshot: FriendsSnapshot): RankingRow[] {
  const { me, friends } = snapshot;
  const rows: RankingRow[] = [
    { key: 'me', rank: me.rank, nickname: me.nickname, badges: me.badges, medals: me.medals, isMe: true },
    ...friends.map((friend): RankingRow => ({
      key: friend.friendshipId, rank: friend.rank, nickname: friend.nickname, badges: friend.badges,
      medals: friend.medals, isMe: false, friendshipId: friend.friendshipId,
    })),
  ];
  return rows.sort((left, right) => left.rank - right.rank);
}

/** "2026-09-28" → "9월 28일". The date is already a Korean calendar date, so no time zone is involved. */
export function asOfLabel(asOf: string): string {
  const [, month, day] = asOf.split('-').map(Number);
  return `${month}월 ${day}일`;
}

/** Said once under the ranking: what friends can see, and up to which day it counts. */
export function rankingNote(asOf: string): string {
  return `친구에게는 메달·배지 수·가본 가게 이름만 보여요 · ${asOfLabel(asOf)} 기준`;
}

/** Said on a friend's passport: the day it counts up to, and why a shop visited today is not there yet. */
export function passportAsOfNote(asOf: string): string {
  return `${asOfLabel(asOf)} 기준이에요. 오늘 다녀온 가게는 내일부터 보여요.`;
}

/** "동네 탐험가 실버, 단골손님 브론즈, 꾸준한 걸음 미획득": tiers are always said in words, never by colour alone. */
export function medalSummary(medals: readonly FriendMedal[]): string {
  return medals.map((medal) => `${medalCopy(medal.key).name} ${tierName(medal.tier)}`).join(', ');
}

export function rowAccessibilityLabel(row: RankingRow): string {
  const who = row.isMe ? `${row.nickname} (나)` : row.nickname;
  return `${row.rank}위, ${who}, 배지 ${row.badges.total}개 중 ${row.badges.earned}개, ${medalSummary(row.medals)}`;
}

export function visitedShopSummary(count: number): string {
  return count === 0 ? '아직 도장이 없어요' : `가본 가게 ${count}곳`;
}

export type NicknameDraft = { ok: true; nickname: string } | { ok: false; message: string };

/** The quick checks worth making before a request; the address, invisible-character and mark rules stay with the server. */
export function checkNicknameDraft(input: string): NicknameDraft {
  const nickname = input.trim();
  if (nickname.length === 0) return { ok: false, message: '별명을 입력해 주세요.' };
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    return { ok: false, message: `별명은 ${MAX_NICKNAME_LENGTH}자까지예요.` };
  }
  return { ok: true, nickname };
}
