import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RecentCouponRedemption, RecentVisit } from '@/commerce/commerce-api';
import {
  cancelConfirmText,
  cancelSuccessMessage,
  kstClockLabel,
  listFailureMessage,
  redemptionRowText,
  staleAfterUndoFailure,
  staleAfterVisitFailure,
  undoConfirmText,
  undoFailureMessage,
  undoHint,
  undoSuccessMessage,
  visitCancelFailureMessage,
  visitCancelReasons,
  visitReasonLabel,
  visitRowAccessibilityLabel,
  visitRowText,
} from './reversal-copy';

const visit = (over: Partial<RecentVisit> = {}): RecentVisit => ({
  visitEventId: 'v1', claimSlotId: 'slot-v1', occurredAt: '2026-09-30T03:05:00.000Z', customerLabel: '손님 K7QM', status: 'VALID',
  progressCounted: true, cancellationReason: null, canCancel: true, ...over,
});
const coupon = (over: Partial<RecentCouponRedemption> = {}): RecentCouponRedemption => ({
  couponId: 'c1', title: '음료 1잔', redeemedAt: '2026-09-30T03:00:00.000Z', customerLabel: '손님 K7QM',
  redeemedByMe: true, undoUntil: '2026-09-30T03:10:00.000Z', canUndo: true, ...over,
});

test('reasons match the server list and time is shown in Korea time', () => {
  assert.deepEqual(visitCancelReasons.map((reason) => reason.code), ['WRONG_CUSTOMER', 'DUPLICATE', 'NOT_A_REAL_VISIT', 'OTHER']);
  assert.equal(kstClockLabel('2026-09-30T03:05:00.000Z'), '12:05');
  assert.equal(kstClockLabel('2026-09-30T14:59:00.000Z'), '23:59');
  assert.equal(kstClockLabel('2026-09-30T15:00:00.000Z'), '00:00');
  assert.equal(visitReasonLabel('DUPLICATE'), '같은 방문을 두 번 확인했어요');
  assert.equal(visitReasonLabel('SOMETHING'), '사유 기록됨');
  assert.equal(visitReasonLabel(null), '사유 기록됨');
});

test('visit rows say whether the visit counted or was cancelled without any account data', () => {
  assert.equal(visitRowText(visit()), '12:05 · 손님 K7QM · 진행 반영');
  assert.equal(visitRowText(visit({ progressCounted: false })), '12:05 · 손님 K7QM · 기록만(진행에 세지 않음)');
  assert.equal(visitRowText(visit({ status: 'CANCELED', cancellationReason: 'DUPLICATE', canCancel: false })),
    '12:05 · 손님 K7QM · 취소됨 · 같은 방문을 두 번 확인했어요');
  assert.equal(visitRowAccessibilityLabel(visit()), '12:05 손님 K7QM 방문 진행 반영');
  assert.match(cancelConfirmText(visit()), /^12:05 손님 K7QM 방문을 취소할까요\?\n/);
  assert.match(cancelConfirmText(visit()), /미사용 쿠폰은 무효/);
});

test('coupon rows show who handled it and how long the undo lasts', () => {
  assert.equal(redemptionRowText(coupon()), '음료 1잔 · 손님 K7QM · 12:00 사용 (내가 처리)');
  assert.equal(redemptionRowText(coupon({ redeemedByMe: false })), '음료 1잔 · 손님 K7QM · 12:00 사용');
  assert.equal(undoHint(coupon()), '12:10까지 되돌릴 수 있어요.');
  const beforeWindowEnd = new Date(new Date(coupon().undoUntil).getTime() - 60_000);
  const afterWindowEnd = new Date(new Date(coupon().undoUntil).getTime() + 60_000);
  assert.equal(undoHint(coupon({ canUndo: false }), afterWindowEnd), '되돌리기 시간이 지났어요.');
  assert.equal(undoHint(coupon({ canUndo: false }), beforeWindowEnd), '본인 쿠폰은 되돌릴 수 없어요.');
  assert.equal(undoConfirmText(coupon()), '음료 1잔 · 손님 K7QM\n쿠폰 사용을 되돌릴까요? 고객이 다시 사용할 수 있게 돼요.');
});

test('success messages report the visible effects and replays', () => {
  const done = { visitEventId: 'v1', status: 'CANCELED' as const, reason: 'DUPLICATE', note: null,
    canceledAt: '2026-09-30T03:06:00.000Z', revokedRewardCount: 0, voidedCouponCount: 0, replayed: false };
  assert.equal(cancelSuccessMessage(done), '방문을 취소했어요.');
  assert.equal(cancelSuccessMessage({ ...done, revokedRewardCount: 1, voidedCouponCount: 2 }),
    '방문을 취소했어요. (보상 권리 1개 취소, 미사용 쿠폰 2장 무효)');
  assert.equal(cancelSuccessMessage({ ...done, replayed: true }), '이미 취소된 방문이에요.');
  assert.equal(undoSuccessMessage({ couponId: 'c1', status: 'ISSUED', replayed: false }), '쿠폰 사용을 되돌렸어요. 고객이 다시 사용할 수 있어요.');
  assert.equal(undoSuccessMessage({ couponId: 'c1', status: 'ISSUED', replayed: true }), '이미 되돌린 쿠폰이에요.');
});

test('every server failure code has a specific Korean message and stale lists are refreshed', () => {
  for (const [code, pattern] of [
    ['VISIT_CANCEL_WINDOW_CLOSED', /방문한 날이 지나/], ['VISIT_REWARD_ALREADY_MINTED', /이미 발행했거나 발행 중/],
    ['VISIT_REWARD_MINT_IN_PROGRESS', /잠시 뒤 다시/], ['VISIT_NOT_FOUND', /찾을 수 없는 방문/],
    ['VISIT_REWARD_COUPON_REDEEMED', /시리즈 쿠폰이 이미 사용돼/],
    ['MERCHANT_ACCESS_DENIED', /권한이 없어요/], ['INVALID_REVERSAL_REASON', /사유를 골라/],
    ['INVALID_REVERSAL_NOTE', /100자 이하/], ['ACCOUNT_DELETED', /삭제/], ['UNKNOWN', /취소하지 못했어요/],
  ] as const) assert.match(visitCancelFailureMessage(409, code), pattern, code);
  for (const [code, pattern] of [
    ['COUPON_UNDO_WINDOW_CLOSED', /10분이 지나/], ['COUPON_NOT_REDEEMED', /사용 처리된 쿠폰이 아니라서/],
    ['COUPON_NOT_FOUND', /찾을 수 없는 쿠폰/], ['MERCHANT_ACCESS_DENIED', /권한이 없어요/],
    ['COUPON_SELF_UNDO', /본인 쿠폰은 직접 되돌릴 수 없어요/], ['COUPON_REQUIREMENT_LOST', /배지 조건이 사라져서 되돌릴 수 없어요/],
    ['ACCOUNT_DELETED', /삭제/], ['UNKNOWN', /되돌리지 못했어요/],
  ] as const) assert.match(undoFailureMessage(409, code), pattern, code);
  assert.match(visitCancelFailureMessage(401, 'HTTP_401'), /다시 로그인/);
  assert.match(undoFailureMessage(401, 'HTTP_401'), /다시 로그인/);
  assert.match(listFailureMessage(403, 'MERCHANT_ACCESS_DENIED', '방문'), /볼 권한이 없어요/);
  assert.match(listFailureMessage(500, 'HTTP_500', '쿠폰 사용'), /최근 쿠폰 사용을 불러오지 못했어요/);
  assert.deepEqual(['VISIT_CANCEL_WINDOW_CLOSED', 'VISIT_NOT_FOUND', 'VISIT_REWARD_ALREADY_MINTED'].map(staleAfterVisitFailure), [true, true, false]);
  assert.deepEqual(['COUPON_UNDO_WINDOW_CLOSED', 'COUPON_NOT_REDEEMED', 'COUPON_NOT_FOUND', 'COUPON_REQUIREMENT_LOST', 'COUPON_SELF_UNDO', 'X']
    .map(staleAfterUndoFailure), [true, true, true, true, false, false]);
});
