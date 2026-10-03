import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canUndoNow, createCouponMutationGate, redeemedCouponTarget } from './immediate-undo';
import type { RecentCouponRedemption } from '@/commerce/commerce-api';

const coupon: RecentCouponRedemption = { couponId: 'c1', title: '혜택', customerLabel: '손님 A', redeemedByMe: true, redeemedAt: '2026-10-03T10:00:00Z', undoUntil: '2026-10-03T10:10:00Z', canUndo: true };
test('쿠폰 ID와 사용 시각이 모두 같은 서버 기록만 즉시 되돌리기로 연결한다', () => {
  const result = { couponId: 'c1', status: 'REDEEMED' as const, redeemedAt: coupon.redeemedAt, replayed: true };
  assert.equal(redeemedCouponTarget(result, [{ ...coupon, couponId: 'c2' }, { ...coupon, redeemedAt: '2026-10-03T09:59:00Z' }, coupon]), coupon);
  assert.equal(redeemedCouponTarget(result, [{ ...coupon, couponId: 'c2' }]), undefined);
});
test('서버 허용·10분 마감·잘못된 시각을 검사하고 마감부터 버튼을 숨긴다', () => {
  const deadline = Date.parse(coupon.undoUntil);
  assert.equal(canUndoNow(coupon, deadline - 1), true);
  assert.equal(canUndoNow(coupon, deadline), false);
  assert.equal(canUndoNow(coupon, deadline + 1), false);
  assert.equal(canUndoNow({ ...coupon, canUndo: false }, deadline - 1), false);
  assert.equal(canUndoNow({ ...coupon, undoUntil: 'invalid' }, deadline - 1), false);
  assert.equal(canUndoNow(undefined, deadline - 1), false);
});
test('사용 성공 안내는 확인창 뒤 기존 undo API를 호출하고 닫힌 화면의 응답과 중복 누름을 막는다', () => {
  const staff = readFileSync(new URL('./staff.tsx', import.meta.url), 'utf8');
  assert.match(staff, /setRecentCoupon\(redeemedCouponTarget\(result, recent\)\)/);
  assert.match(staff, /label="사용 되돌리기 \(10분 안\)"/);
  assert.match(staff, /onPress: \(\) => void undoImmediateCoupon\(coupon, current\)/);
  assert.match(staff, /api\.undoCouponRedemption\(\{ merchantId, couponId: coupon.couponId \}\)/);
  assert.match(staff, /!couponMutation.acquire\(\)/);
  assert.match(staff, /if \(!undoGate.isCurrent\(current\)\) return/);
  assert.match(staff, /undoGate.cancel\(\)/);
  assert.match(staff, /\[issued, recentCoupon\]/);
  assert.doesNotMatch(staff, /되돌릴 수 없어요/);
});

test('다음 쿠폰 사용 응답을 기다리는 동안 이전 쿠폰 되돌리기와 이중 사용을 차단한다', async () => {
  const gate = createCouponMutationGate();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  assert.equal(gate.acquire(), true);
  const redemption = pending.finally(() => gate.release());
  assert.equal(gate.acquire(), false);
  assert.equal(gate.isBusy(), true);
  finish();
  await redemption;
  assert.equal(gate.acquire(), true);
  assert.equal(gate.acquire(), false);
  gate.release();
  assert.equal(gate.isBusy(), false);
});
