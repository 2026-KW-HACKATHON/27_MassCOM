import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BadgeBook, Coupon, Medal, MedalKind, Reward } from './badge-api';
import {
  badgesToNextBox,
  couponAccessibilityLabel,
  couponAfterPoll,
  couponForUse,
  couponExpiryLabel,
  couponStatusLabel,
  couponsOf,
  diffBadgeBooks,
  explorerRank,
  featuredRaisedMedal,
  findCoupon,
  medalAccessibilityLabel,
  medalProgressText,
  medalTitle,
  nextTierProgress,
  openRewardErrorMessage,
  remainingLabel,
  rewardAccessibilityLabel,
  rewardBoxName,
  rewardStatusText,
  shareCardCopy,
  shareMessage,
  tierName,
} from './badge-rules';
import * as rules from './badge-rules';

const thresholds: Record<MedalKind, readonly [number, number, number]> = {
  explorer: [1, 2, 3], regular: [2, 3, 5], steady: [2, 4, 7],
};

function medal(kind: MedalKind, value: number): Medal {
  const tier = thresholds[kind].filter((threshold) => value >= threshold).length as Medal['tier'];
  return { kind, value, tier, thresholds: thresholds[kind] };
}

const coupon: Coupon = {
  couponId: 'coupon-1', milestone: 1, merchantId: 'm-a', merchantName: '가상 점포 A',
  title: '체험 음료 1잔', detail: '', status: 'ISSUED',
  issuedAt: '2026-09-29T01:00:00.000Z', expiresAt: '2026-10-29T01:00:00.000Z', redeemedAt: null,
};

function book(values: Record<MedalKind, number>, states: Reward['state'][] = ['LOCKED', 'LOCKED', 'LOCKED']): BadgeBook {
  const medals = (['explorer', 'regular', 'steady'] as const).map((kind) => medal(kind, values[kind]));
  return {
    medals,
    earnedTiers: medals.reduce((sum, item) => sum + item.tier, 0),
    rewards: ([1, 2, 3] as const).map((milestone, index) => ({
      milestone,
      requiredTiers: milestone * 3,
      state: states[index]!,
      offer: null,
      coupon: states[index] === 'OPENED' ? { ...coupon, milestone, couponId: `coupon-${milestone}` } : null,
    })),
  };
}

test('medal copy names the three kinds and their tiers', () => {
  assert.equal(medalTitle(medal('explorer', 3)), '동네 탐험가 골드');
  assert.equal(medalTitle(medal('regular', 3)), '단골손님 실버');
  assert.equal(medalTitle(medal('steady', 2)), '꾸준한 걸음 브론즈');
  assert.equal(medalTitle(medal('steady', 1)), '꾸준한 걸음');
  assert.deepEqual([0, 1, 2, 3].map((tier) => tierName(tier as Medal['tier'])), ['미획득', '브론즈', '실버', '골드']);
});

test('next-tier progress measures from the current threshold to the next', () => {
  assert.deepEqual(nextTierProgress(medal('regular', 0)), { nextTier: 1, target: 2, remaining: 2, fraction: 0 });
  assert.deepEqual(nextTierProgress(medal('regular', 1)), { nextTier: 1, target: 2, remaining: 1, fraction: 0.5 });
  assert.deepEqual(nextTierProgress(medal('regular', 3)), { nextTier: 3, target: 5, remaining: 2, fraction: 0 });
  assert.deepEqual(nextTierProgress(medal('regular', 4)), { nextTier: 3, target: 5, remaining: 1, fraction: 0.5 });
  assert.deepEqual(nextTierProgress(medal('steady', 9)), { nextTier: null, target: null, remaining: null, fraction: 1 });
  assert.equal(medalProgressText(medal('explorer', 1)), '실버까지 1곳 더');
  assert.equal(medalProgressText(medal('regular', 0)), '브론즈까지 2번 더');
  assert.equal(medalProgressText(medal('steady', 5)), '골드까지 2일 더');
  assert.equal(medalProgressText(medal('explorer', 4)), '골드 달성! 최고 등급이에요');
});

test('accessibility label carries tier, value and next goal as text', () => {
  assert.equal(
    medalAccessibilityLabel(medal('explorer', 2)),
    '동네 탐험가 배지, 실버, 서로 다른 가게 2곳, 골드까지 1곳 더',
  );
  assert.equal(
    medalAccessibilityLabel(medal('steady', 0)),
    '꾸준한 걸음 배지, 미획득, 방문한 날 0일, 브론즈까지 2일 더',
  );
});

test('explorer rank follows earned tiers per spec §2', () => {
  const titles = Array.from({ length: 10 }, (_, earned) => explorerRank(earned).title);
  assert.deepEqual(titles, [
    '새내기 탐험가', '동네 산책가', '동네 산책가', '골목 탐험가', '골목 탐험가', '골목 탐험가',
    '월계 미식가', '월계 미식가', '월계 미식가', '월계 마스터',
  ]);
});

test('reward boxes are named and report the badges still needed', () => {
  assert.deepEqual([1, 2, 3].map((m) => rewardBoxName(m as 1 | 2 | 3)), ['첫 번째 상자', '두 번째 상자', '황금 상자']);
  assert.equal(badgesToNextBox(book({ explorer: 1, regular: 0, steady: 0 })), 2);
  assert.equal(badgesToNextBox(book({ explorer: 3, regular: 0, steady: 0 })), 3);
  assert.equal(badgesToNextBox(book({ explorer: 3, regular: 5, steady: 7 })), null);
  assert.equal(rewardStatusText({ state: 'LOCKED', requiredTiers: 6 }, 4), '배지 2개 더');
  assert.equal(rewardStatusText({ state: 'READY', requiredTiers: 3 }, 3), '지금 열 수 있어요');
  assert.equal(rewardStatusText({ state: 'UNAVAILABLE', requiredTiers: 3 }, 3), '달성! 참여 가게 혜택 준비 중');
  // 관리자가 쿠폰을 무효로 한 상자는 준비 중이라고 하지 않고 더 받을 수 없다고 정확히 알린다.
  assert.equal(rewardStatusText({ state: 'UNAVAILABLE', requiredTiers: 3, unavailableReason: 'COUPON_REVOKED' }, 3),
    '이 혜택은 더 이상 받을 수 없어요');
  assert.equal(rewardStatusText({ state: 'OPENED', requiredTiers: 3 }, 3), '쿠폰을 받았어요');
  const locked: Reward = {
    milestone: 2, requiredTiers: 6, state: 'LOCKED', coupon: null,
    offer: { merchantId: 'm-b', merchantName: '가상 점포 B', title: '체험 디저트', detail: '', validDays: 30 },
  };
  assert.equal(rewardAccessibilityLabel(locked, 4), '두 번째 상자, 배지 6개 필요, 배지 2개 더, 혜택 가상 점포 B 체험 디저트');
  const voided: Reward = {
    milestone: 1, requiredTiers: 3, state: 'UNAVAILABLE', coupon: null, offer: null, unavailableReason: 'COUPON_REVOKED',
  };
  assert.equal(rewardAccessibilityLabel(voided, 3), '첫 번째 상자, 배지 3개 필요, 이 혜택은 더 이상 받을 수 없어요');
});

test('diff reports newly raised tiers and newly openable boxes only', () => {
  const before = book({ explorer: 2, regular: 1, steady: 1 });
  const after = book({ explorer: 3, regular: 2, steady: 1 }, ['READY', 'LOCKED', 'LOCKED']);
  const diff = diffBadgeBooks(before, after);
  assert.deepEqual(diff.raisedMedals.map((item) => [item.kind, item.fromTier, item.toTier]), [
    ['explorer', 2, 3], ['regular', 0, 1],
  ]);
  assert.deepEqual(diff.newlyReady.map((reward) => reward.milestone), [1]);
  assert.equal(featuredRaisedMedal(diff)?.kind, 'explorer');

  const unchanged = diffBadgeBooks(after, after);
  assert.deepEqual(unchanged, { raisedMedals: [], newlyReady: [] });
  const opened = diffBadgeBooks(book({ explorer: 3, regular: 2, steady: 1 }, ['OPENED', 'LOCKED', 'LOCKED']), after);
  assert.deepEqual(opened.newlyReady, []);
  assert.deepEqual(diffBadgeBooks(undefined, after), { raisedMedals: [], newlyReady: [] });
  assert.deepEqual(diffBadgeBooks(before, undefined), { raisedMedals: [], newlyReady: [] });
  assert.equal(featuredRaisedMedal(unchanged), undefined);
});

test('share copy carries only the medal and its count', () => {
  const gold = medal('explorer', 3);
  const card = shareCardCopy(gold, 'production');
  assert.equal(card.title, '동네 탐험가 골드');
  assert.equal(card.body, '서로 다른 가게 3곳을 발견했어요');
  assert.equal(card.footer, '월계 마스코트 · masscom.kr');
  assert.equal(card.demoNote, null);
  assert.equal(shareCardCopy(gold, 'showcase').demoNote, '체험용 가상 기록');

  const production = shareMessage(gold, 'production');
  const showcase = shareMessage(gold, 'showcase');
  assert.match(production, /동네 탐험가 골드.*서로 다른 가게 3곳/s);
  assert.match(production, /https:\/\/www\.masscom\.kr\/app\/$/);
  assert.match(showcase, /체험용 가상 기록.*https:\/\/demo-api\.masscom\.kr\/play\/$/s);
  assert.doesNotMatch(production, /체험용/);
  for (const text of [production, showcase, JSON.stringify(card)]) {
    assert.doesNotMatch(text, /customer|account|계정|wallet|지갑|0x[0-9a-f]|QR|쿠폰|가상 점포|\d{4}-\d{2}-\d{2}|merchant/i);
  }
  assert.throws(() => shareCardCopy(medal('regular', 1), 'production'), /BADGE_NOT_EARNED/);
  assert.throws(() => shareMessage(medal('regular', 1), 'showcase'), /BADGE_NOT_EARNED/);
});

test('coupon expiry uses the Korean calendar date', () => {
  assert.equal(couponExpiryLabel('2026-10-29T01:00:00.000Z'), '~10월 29일까지');
  // 15:30 UTC is already the next day in Seoul.
  assert.equal(couponExpiryLabel('2026-10-28T15:30:00.000Z'), '~10월 29일까지');
  assert.equal(couponExpiryLabel('2026-12-31T14:59:59.000Z'), '~12월 31일까지');
  assert.equal(couponExpiryLabel('2026-12-31T15:00:00.000Z'), '~1월 1일까지');
  assert.deepEqual(['ISSUED', 'REDEEMED', 'EXPIRED'].map((s) => couponStatusLabel(s as Coupon['status'])), ['사용 가능', '사용 완료', '만료']);
  assert.equal(couponAccessibilityLabel(coupon), '쿠폰 체험 음료 1잔, 가상 점포 A, 사용 가능, 10월 29일까지');
  assert.equal(couponStatusLabel('VOIDED'), '사용할 수 없는 쿠폰');
  // 무효 쿠폰은 "~까지" 만료 날짜가 오해를 부르므로 읽어 주지 않는다(다른 상태는 그대로다).
  assert.equal(couponAccessibilityLabel({ ...coupon, status: 'VOIDED' }), '쿠폰 체험 음료 1잔, 가상 점포 A, 사용할 수 없는 쿠폰');
});

test('an open coupon sheet follows the polled book: redeemed, voided or withdrawn', () => {
  const opened = book({ explorer: 3, regular: 5, steady: 7 }, ['OPENED', 'READY', 'READY']);
  const current = couponsOf(opened)[0]!;
  // 아직 쓸 수 있으면 아무것도 바꾸지 않는다.
  assert.equal(couponAfterPoll(current, opened), undefined);
  const withStatus = (status: Coupon['status']) => ({
    rewards: opened.rewards.map((reward) => (reward.coupon ? { ...reward, coupon: { ...reward.coupon, status } } : reward)),
  });
  assert.equal(couponAfterPoll(current, withStatus('REDEEMED'))?.status, 'REDEEMED');
  assert.equal(couponAfterPoll(current, withStatus('VOIDED'))?.status, 'VOIDED');
  assert.equal(couponAfterPoll(current, withStatus('EXPIRED'))?.status, 'EXPIRED');
  // 방문 취소로 무효가 된 쿠폰은 도감에서 사라진다: 목록에 없으면 사용할 수 없는 쿠폰이다.
  const withdrawn = couponAfterPoll(current, { rewards: opened.rewards.map((reward) => ({ ...reward, coupon: null })) });
  assert.equal(withdrawn?.status, 'VOIDED');
  assert.equal(withdrawn?.couponId, current.couponId);
  assert.equal(withdrawn?.title, current.title);
  assert.equal(couponForUse(current, opened, Date.parse(current.expiresAt) - 1).status, 'ISSUED');
  assert.equal(couponForUse(current, opened, Date.parse(current.expiresAt)).status, 'EXPIRED');
  assert.equal(couponForUse(current, { rewards: opened.rewards.map((reward) => ({ ...reward, coupon: null })) }).status, 'VOIDED');
  assert.equal(couponForUse(current, { rewards: opened.rewards.map((reward) => reward.coupon
    ? { ...reward, coupon: { ...reward.coupon, merchantId: 'another-merchant' } } : reward) }).status, 'VOIDED');
});

test('coupons are listed from opened boxes and found by id', () => {
  const opened = book({ explorer: 3, regular: 5, steady: 7 }, ['OPENED', 'READY', 'OPENED']);
  assert.deepEqual(couponsOf(opened).map((item) => item.couponId), ['coupon-1', 'coupon-3']);
  assert.equal(findCoupon(opened, 'coupon-3')?.milestone, 3);
  assert.equal(findCoupon(opened, 'nope'), undefined);
  assert.deepEqual(couponsOf(undefined), []);
});

test('identity countdown and reward errors read as friendly Korean', () => {
  const now = Date.parse('2026-09-29T00:00:00.000Z');
  assert.equal(remainingLabel('2026-09-29T00:01:42.000Z', now), '1분 42초 남음');
  assert.equal(remainingLabel('2026-09-29T00:00:08.000Z', now), '8초 남음');
  assert.equal(remainingLabel('2026-09-29T00:00:00.000Z', now), '만료됐어요');
  for (const code of ['REWARD_LOCKED', 'REWARD_OFFER_UNAVAILABLE', 'REWARD_CAPACITY_EXHAUSTED', 'INVALID_REQUEST', 'HTTP_500', undefined]) {
    const message = openRewardErrorMessage(code);
    assert.ok(message.length > 0);
    assert.doesNotMatch(message, /REWARD_|HTTP_|INVALID/);
  }
});

test('closest next goal nudges toward the nearest tier', () => {
  const { closestNextGoal } = rules;
  assert.equal(closestNextGoal(book({ explorer: 1, regular: 1, steady: 0 })), '동네 탐험가 실버까지 1곳 더');
  assert.equal(closestNextGoal(book({ explorer: 3, regular: 4, steady: 7 })), '단골손님 골드까지 1번 더');
  assert.equal(closestNextGoal(book({ explorer: 3, regular: 5, steady: 7 })), null);
  assert.equal(closestNextGoal(undefined), null);
});

test('three-up rows stack for narrow screens and large text', () => {
  const { shouldStackTrio } = rules;
  assert.equal(shouldStackTrio(384, 1), false);
  assert.equal(shouldStackTrio(360, 1), false);
  assert.equal(shouldStackTrio(320, 1), true);
  assert.equal(shouldStackTrio(412, 1.3), true);
  assert.equal(shouldStackTrio(412, 1.15), false);
  assert.equal(shouldStackTrio(600, 1.5), true);
  assert.equal(shouldStackTrio(360, 0.85), false);
});

test('medal cards split progress into two deliberate lines', () => {
  const { medalProgressLines } = rules;
  assert.deepEqual(medalProgressLines(medal('explorer', 0)), ['브론즈까지', '1곳 더']);
  assert.deepEqual(medalProgressLines(medal('regular', 3)), ['골드까지', '2번 더']);
  assert.deepEqual(medalProgressLines(medal('steady', 7)), ['골드 달성!', '최고 등급']);
});

test('the passport call to action points at the first openable box', () => {
  const { firstReadyReward } = rules;
  assert.equal(firstReadyReward(book({ explorer: 3, regular: 5, steady: 7 }, ['OPENED', 'READY', 'READY']))?.milestone, 2);
  assert.equal(firstReadyReward(book({ explorer: 1, regular: 0, steady: 0 })), undefined);
  assert.equal(firstReadyReward(undefined), undefined);
});

test('the home reward teaser picks a ready box first, else the next locked one, else the last box', () => {
  const { homeFeaturedReward } = rules;
  assert.equal(homeFeaturedReward(book({ explorer: 3, regular: 5, steady: 7 }, ['OPENED', 'READY', 'READY']))?.milestone, 2);
  assert.equal(homeFeaturedReward(book({ explorer: 1, regular: 0, steady: 0 }))?.milestone, 1);
  assert.equal(homeFeaturedReward(book({ explorer: 3, regular: 5, steady: 7 }, ['OPENED', 'OPENED', 'OPENED']))?.milestone, 3);
  assert.equal(homeFeaturedReward(undefined), undefined);
});

test('celebration stage and coupon QR shrink on short screens', () => {
  const { celebrationStageSize, couponQrSize } = rules;
  assert.equal(celebrationStageSize(360, 640), 187);
  assert.equal(celebrationStageSize(412, 915), 214);
  assert.equal(celebrationStageSize(600, 1200), 220);
  assert.equal(couponQrSize(360, 640), 218);
  assert.equal(couponQrSize(412, 915), 240);
  assert.equal(couponQrSize(320, 480), 163);
  assert.equal(couponQrSize(240, 400), 160);
});
