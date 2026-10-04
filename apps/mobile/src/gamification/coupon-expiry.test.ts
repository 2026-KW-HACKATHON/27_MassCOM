import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BadgeBook, Coupon } from './badge-api';
import { couponExpiryNotice, couponExpiryReminderLabel, expiringCoupons } from './coupon-expiry';

function coupon(expiresAt: string, status: Coupon['status'] = 'ISSUED', couponId = 'coupon-1'): Coupon {
  return { couponId, milestone: 1, merchantId: 'm-1', merchantName: '가게', title: '음료', detail: '',
    status, issuedAt: '2026-09-01T00:00:00.000Z', expiresAt,
    redeemedAt: status === 'REDEEMED' ? '2026-10-01T00:00:00.000Z' : null };
}

function book(...coupons: Coupon[]): BadgeBook {
  return { medals: [], earnedTiers: 0, rewards: coupons.map((item) => ({ milestone: item.milestone,
    requiredTiers: 3, state: 'OPENED', offer: null, coupon: item })) };
}

test('한국 자정에서 내일 만료가 오늘 만료로 바뀐다', () => {
  const item = coupon('2026-10-05T10:00:00.000Z');
  assert.equal(couponExpiryReminderLabel(item, new Date('2026-10-04T14:59:59.999Z')), '내일 만료');
  assert.equal(couponExpiryReminderLabel(item, new Date('2026-10-04T15:00:00.000Z')), '오늘 만료');
});

test('같은 한국 날짜라도 만료 시각에 도달한 쿠폰은 제외한다', () => {
  const now = new Date('2026-10-04T10:00:00.000Z');
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-04T09:59:59.999Z'), now), null);
  assert.equal(couponExpiryReminderLabel(coupon(now.toISOString()), now), null);
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-04T10:00:00.001Z'), now), '오늘 만료');
});

test('사용 완료·무효·만료 쿠폰은 남은 시간과 관계없이 제외한다', () => {
  const now = new Date('2026-10-04T00:00:00.000Z');
  for (const status of ['REDEEMED', 'VOIDED', 'EXPIRED'] as const) {
    assert.deepEqual(expiringCoupons(book(coupon('2026-10-05T00:00:00.000Z', status)), now), []);
  }
});

test('한국 달력으로 정확히 3일 남은 날짜까지 포함하고 4일은 제외한다', () => {
  const now = new Date('2026-10-03T15:00:00.000Z'); // 10월 4일 00:00 KST
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-06T15:00:00.000Z'), now), '3일 남음');
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-07T14:59:59.999Z'), now), '3일 남음');
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-07T15:00:00.000Z'), now), null);
  assert.equal(couponExpiryReminderLabel(coupon('2026-10-05T15:00:00.000Z'), now), '2일 남음');
});

test('만료 시각 순으로 정렬하며 원본 순서를 바꾸지 않고 가장 빠른 한국 날짜를 안내한다', () => {
  const now = new Date('2026-10-04T00:00:00.000Z');
  const source = book(coupon('2026-10-06T16:00:00.000Z', 'ISSUED', 'later'),
    coupon('2026-10-04T16:00:00.000Z', 'ISSUED', 'earlier'),
    coupon('2026-10-04T17:00:00.000Z', 'ISSUED', 'same-day'));
  assert.deepEqual(expiringCoupons(source, now).map(({ coupon: item, label }) => [item.couponId, label]),
    [['earlier', '내일 만료'], ['same-day', '내일 만료'], ['later', '3일 남음']]);
  assert.equal(source.rewards[0]?.coupon?.couponId, 'later');
  assert.equal(couponExpiryNotice(source, now), '쿠폰 3장이 곧 만료돼요 · 가장 빠른 만료: 10월 5일');
});

test('빈 책·아직 불러오지 않은 책·가까운 만료가 없는 책에는 안내하지 않는다', () => {
  const now = new Date('2026-10-04T00:00:00.000Z');
  for (const source of [undefined, book(), book(coupon('2026-10-10T00:00:00.000Z')),
    { ...book(), rewards: [{ milestone: 1 as const, requiredTiers: 3, state: 'LOCKED' as const, offer: null, coupon: null }] }]) {
    assert.deepEqual(expiringCoupons(source, now), []);
    assert.equal(couponExpiryNotice(source, now), null);
  }
});
