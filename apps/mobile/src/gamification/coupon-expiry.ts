import type { BadgeBook, Coupon } from './badge-api';
import { couponsOf, kstCalendarDay, kstParts } from './badge-rules';

/** 만료 시각과 서버 상태를 모두 확인하고, 남은 날짜는 한국 달력으로 센다. */
export function couponExpiryReminderLabel(coupon: Coupon, now: Date): string | null {
  const expires = Date.parse(coupon.expiresAt);
  if (coupon.status !== 'ISSUED' || !Number.isFinite(expires) || expires <= now.getTime()) return null;
  const days = kstCalendarDay(coupon.expiresAt) - kstCalendarDay(now.toISOString());
  if (days < 0 || days > 3) return null;
  return days === 0 ? '오늘 만료' : days === 1 ? '내일 만료' : `${days}일 남음`;
}

export function expiringCoupons(book: BadgeBook | undefined, now: Date): { coupon: Coupon; label: string }[] {
  return couponsOf(book).flatMap((coupon) => {
    const label = couponExpiryReminderLabel(coupon, now);
    return label ? [{ coupon, label }] : [];
  }).sort((a, b) => Date.parse(a.coupon.expiresAt) - Date.parse(b.coupon.expiresAt));
}

export function couponExpiryNotice(book: BadgeBook | undefined, now: Date): string | null {
  const coupons = expiringCoupons(book, now);
  if (!coupons.length) return null;
  const { month, day } = kstParts(coupons[0]!.coupon.expiresAt);
  return `쿠폰 ${coupons.length}장이 곧 만료돼요 · 가장 빠른 만료: ${month}월 ${day}일`;
}
