import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Friend, FriendMe, FriendsSnapshot } from './friends-api';
import {
  asOfLabel,
  buildRankingRows,
  checkNicknameDraft,
  medalSummary,
  passportAsOfNote,
  rankingNote,
  rowAccessibilityLabel,
  visitedShopSummary,
} from './friends-model';

const medals = (explorer: 0 | 1 | 2 | 3, regular: 0 | 1 | 2 | 3, steady: 0 | 1 | 2 | 3) => [
  { key: 'explorer' as const, tier: explorer },
  { key: 'regular' as const, tier: regular },
  { key: 'steady' as const, tier: steady },
];

function friend(id: string, nickname: string, rank: number, tiers: [0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3], stamps = 0): Friend {
  return {
    friendshipId: id, nickname, rank, medals: medals(...tiers),
    badges: { earned: tiers[0] + tiers[1] + tiers[2], total: 9 },
    stamps: Array.from({ length: stamps }, (_, index) => ({ merchantName: `가게 ${index}` })),
  };
}

const me: FriendMe = {
  nickname: '탐험가 K7M2', code: 'K7M2Q9XP', rank: 2, asOf: '2026-09-28',
  badges: { earned: 4, total: 9 }, medals: medals(2, 1, 1),
};

test('puts me among my friends in the server rank order, marking my own row', () => {
  const snapshot: FriendsSnapshot = {
    me,
    friends: [friend('c', '다인', 3, [1, 0, 0]), friend('a', '가은', 1, [3, 2, 1]), friend('b', '나래', 4, [0, 0, 0])],
  };
  const rows = buildRankingRows(snapshot);
  assert.deepEqual(rows.map((row) => [row.rank, row.nickname, row.isMe]), [
    [1, '가은', false], [2, '탐험가 K7M2', true], [3, '다인', false], [4, '나래', false],
  ]);
  assert.equal(rows[1]!.friendshipId, undefined);
  assert.equal(rows[0]!.friendshipId, 'a');
  assert.deepEqual(rows.map((row) => row.key), ['a', 'me', 'c', 'b']);
});

test('with no friends the list is only me', () => {
  const rows = buildRankingRows({ me: { ...me, rank: 1 }, friends: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.isMe, true);
});

test('says which day the friend numbers count up to', () => {
  assert.equal(asOfLabel('2026-09-28'), '9월 28일');
  assert.equal(asOfLabel('2026-01-05'), '1월 5일');
  assert.equal(asOfLabel('2026-12-31'), '12월 31일');
  assert.equal(
    rankingNote('2026-09-28'),
    '친구에게는 메달·배지 수·가본 가게 이름만 보여요 · 9월 28일 기준',
  );
});

test('a friend passport says up to which day it counts and that today shows tomorrow', () => {
  assert.equal(passportAsOfNote('2026-09-28'), '9월 28일 기준이에요. 오늘 다녀온 가게는 내일부터 보여요.');
});

test('reads medals with their tier names, including a medal not earned yet', () => {
  assert.equal(medalSummary(medals(2, 1, 0)), '동네 탐험가 실버, 단골손님 브론즈, 꾸준한 걸음 미획득');
  assert.equal(medalSummary(medals(3, 3, 3)), '동네 탐험가 골드, 단골손님 골드, 꾸준한 걸음 골드');
});

test('a ranking row reads as one sentence, and says which row is mine', () => {
  const [row, mine] = buildRankingRows({ me, friends: [friend('a', '가은', 1, [3, 2, 1])] });
  assert.equal(
    rowAccessibilityLabel(row!),
    '1위, 가은, 배지 9개 중 6개, 동네 탐험가 골드, 단골손님 실버, 꾸준한 걸음 브론즈',
  );
  assert.equal(
    rowAccessibilityLabel(mine!),
    '2위, 탐험가 K7M2 (나), 배지 9개 중 4개, 동네 탐험가 실버, 단골손님 브론즈, 꾸준한 걸음 브론즈',
  );
});

test('summarises the shops a friend has stamped without dates or counts', () => {
  assert.equal(visitedShopSummary(0), '아직 도장이 없어요');
  assert.equal(visitedShopSummary(3), '가본 가게 3곳');
});

test('checks a nickname draft before asking the server, and leaves the finer rules to the server', () => {
  assert.deepEqual(checkNicknameDraft('  민지 '), { ok: true, nickname: '민지' });
  assert.deepEqual(checkNicknameDraft('가'.repeat(12)), { ok: true, nickname: '가'.repeat(12) });
  assert.deepEqual(checkNicknameDraft('😀'.repeat(12)), { ok: true, nickname: '😀'.repeat(12) });
  const empty = checkNicknameDraft('   ');
  assert.equal(empty.ok, false);
  assert.match((empty as { message: string }).message, /입력/);
  const long = checkNicknameDraft('가'.repeat(13));
  assert.equal(long.ok, false);
  assert.match((long as { message: string }).message, /12자/);
});
