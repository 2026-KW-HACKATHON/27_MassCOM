import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMedals,
  couponExpiry,
  couponStatus,
  earnedTiers,
  isRewardMilestone,
  offerHasCapacity,
  rewardMilestones,
  rewardState,
  tierFor,
} from './badge-rules.js';

test('tierFor counts the reached thresholds and stops at gold', () => {
  const explorer = [1, 2, 3];
  assert.deepEqual([0, 1, 2, 3, 4, 99].map((value) => tierFor(value, explorer)), [0, 1, 2, 3, 3, 3]);
  const regular = [2, 3, 5];
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((value) => tierFor(value, regular)), [0, 0, 1, 2, 2, 3, 3]);
  const steady = [2, 4, 7];
  assert.deepEqual([1, 2, 3, 4, 6, 7].map((value) => tierFor(value, steady)), [0, 1, 1, 2, 2, 3]);
});

test('buildMedals returns the contract shape and earnedTiers sums the three tiers', () => {
  const medals = buildMedals({ explorer: 2, regular: 1, steady: 1 });
  assert.deepEqual(medals, [
    { kind: 'explorer', value: 2, tier: 2, thresholds: [1, 2, 3] },
    { kind: 'regular', value: 1, tier: 0, thresholds: [2, 3, 5] },
    { kind: 'steady', value: 1, tier: 0, thresholds: [2, 4, 7] },
  ]);
  assert.equal(earnedTiers(medals), 2);
  assert.equal(earnedTiers(buildMedals({ explorer: 3, regular: 5, steady: 7 })), 9);
  assert.equal(earnedTiers(buildMedals({ explorer: 0, regular: 0, steady: 0 })), 0);
});

test('reward milestones need 3, 6 and 9 tiers and only 1 to 3 are valid', () => {
  assert.deepEqual(rewardMilestones.map(({ requiredTiers }) => requiredTiers), [3, 6, 9]);
  assert.deepEqual([0, 1, 2, 3, 4, 1.5].map(isRewardMilestone), [false, true, true, true, false, false]);
});

test('rewardState covers LOCKED, READY, UNAVAILABLE and OPENED', () => {
  const open = { issuanceCap: null, issuedCount: 40 };
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 2, offer: open, hasCoupon: false }), 'LOCKED');
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 2, offer: null, hasCoupon: false }), 'LOCKED');
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 3, offer: open, hasCoupon: false }), 'READY');
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 3, offer: null, hasCoupon: false }), 'UNAVAILABLE');
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 9,
    offer: { issuanceCap: 5, issuedCount: 5 }, hasCoupon: false }), 'UNAVAILABLE');
  assert.equal(rewardState({ requiredTiers: 3, earnedTiers: 9,
    offer: { issuanceCap: 5, issuedCount: 4 }, hasCoupon: false }), 'READY');
  // 쿠폰이 있으면 배지가 부족해 보여도 혜택이 없어져도 OPENED다.
  assert.equal(rewardState({ requiredTiers: 9, earnedTiers: 0, offer: null, hasCoupon: true }), 'OPENED');
  assert.equal(offerHasCapacity({ issuanceCap: 1, issuedCount: 0 }), true);
  assert.equal(offerHasCapacity({ issuanceCap: 1, issuedCount: 1 }), false);
});

test('coupon expiry is derived only for ISSUED coupons at or after expiresAt', () => {
  const expiresAt = new Date('2026-10-29T00:00:00.000Z');
  assert.equal(couponStatus('ISSUED', expiresAt, new Date('2026-10-28T23:59:59.999Z')), 'ISSUED');
  assert.equal(couponStatus('ISSUED', expiresAt, expiresAt), 'EXPIRED');
  assert.equal(couponStatus('REDEEMED', expiresAt, new Date('2027-01-01T00:00:00.000Z')), 'REDEEMED');
});

test('coupon expiry is the last KST calendar day 23:59:59.999, so a date-only label is never early', () => {
  // 2026-09-29 09:00 KST 발급, 30일 → 10월 29일 23:59:59.999 KST
  assert.equal(couponExpiry(new Date('2026-09-29T00:00:00.000Z'), 30).toISOString(), '2026-10-29T14:59:59.999Z');
  // 한국 날짜가 같은 9월 29일 오후 2시와 자정 직전은 같은 마지막 날을 가진다.
  assert.equal(couponExpiry(new Date('2026-09-29T05:00:00.000Z'), 30).toISOString(), '2026-10-29T14:59:59.999Z');
  assert.equal(couponExpiry(new Date('2026-09-29T14:59:59.999Z'), 30).toISOString(), '2026-10-29T14:59:59.999Z');
  // 한국 자정이 지나면(UTC 15:00) 다음 날짜로 계산한다.
  assert.equal(couponExpiry(new Date('2026-09-29T15:00:00.000Z'), 30).toISOString(), '2026-10-30T14:59:59.999Z');
  assert.equal(couponExpiry(new Date('2026-09-28T15:00:00.000Z'), 30).toISOString(), '2026-10-29T14:59:59.999Z');
  // 하루 혜택은 발급 다음 날 23:59:59.999 KST까지이며 발급 시각보다 항상 뒤다.
  const issued = new Date('2026-12-31T14:59:59.999Z');
  assert.equal(couponExpiry(issued, 1).toISOString(), '2027-01-01T14:59:59.999Z');
  assert.ok(couponExpiry(issued, 1).getTime() > issued.getTime());
  // 만료 판정은 expiresAt 이상이면 EXPIRED다.
  const expiresAt = couponExpiry(new Date('2026-09-29T05:00:00.000Z'), 30);
  assert.equal(couponStatus('ISSUED', expiresAt, new Date('2026-10-29T14:59:59.998Z')), 'ISSUED');
  assert.equal(couponStatus('ISSUED', expiresAt, new Date('2026-10-29T15:00:00.000Z')), 'EXPIRED');
});
