import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isReissuableVoid } from './badge-rules.js';
import {
  canCancelVisitOn,
  classifyMintJob,
  couponUndoDeadline,
  isCouponVoidReason,
  isStaffSelfClaim,
  isVisitCancelReason,
  isWithinCouponUndoWindow,
  kstBusinessDate,
  maskedCustomerLabel,
  milestonesToVoid,
  normalizeReversalNote,
  selectEntitlementsToRevoke,
} from './reversal-rules.js';

test('reason lists are fixed and reject anything else', () => {
  assert.deepEqual(
    ['WRONG_CUSTOMER', 'DUPLICATE', 'NOT_A_REAL_VISIT', 'OTHER', 'wrong_customer', '', 7, null].map(isVisitCancelReason),
    [true, true, true, true, false, false, false, false],
  );
  assert.deepEqual(
    ['ISSUED_IN_ERROR', 'ABUSE_SUSPECTED', 'MERCHANT_REQUEST', 'OTHER', 'VISIT_CANCELED', 'DUPLICATE'].map(isCouponVoidReason),
    [true, true, true, true, false, false],
  );
});

test('the KST business date flips exactly at 15:00:00.000 UTC', () => {
  assert.equal(kstBusinessDate(new Date('2026-09-30T14:59:59.999Z')), '2026-09-30');
  assert.equal(kstBusinessDate(new Date('2026-09-30T15:00:00.000Z')), '2026-10-01');
  assert.equal(kstBusinessDate(new Date('2026-09-30T00:00:00.000Z')), '2026-09-30');
  assert.equal(kstBusinessDate(new Date('2026-12-31T15:00:00.000Z')), '2027-01-01');
  assert.equal(canCancelVisitOn('2026-09-30', new Date('2026-09-30T14:59:59.999Z')), true);
  assert.equal(canCancelVisitOn('2026-09-30', new Date('2026-09-30T15:00:00.000Z')), false);
  assert.equal(canCancelVisitOn('2026-09-29', new Date('2026-09-30T00:00:00.000Z')), false);
});

test('a coupon can be undone up to exactly ten minutes after it was redeemed', () => {
  const redeemedAt = new Date('2026-09-30T03:00:00.000Z');
  assert.equal(couponUndoDeadline(redeemedAt).toISOString(), '2026-09-30T03:10:00.000Z');
  assert.equal(isWithinCouponUndoWindow(redeemedAt, new Date('2026-09-30T03:10:00.000Z')), true);
  assert.equal(isWithinCouponUndoWindow(redeemedAt, new Date('2026-09-30T03:10:00.001Z')), false);
  assert.equal(isWithinCouponUndoWindow(redeemedAt, new Date('2026-09-30T03:00:00.000Z')), true);
});

test('notes are trimmed, collapsed and limited to 100 code points without personal data', () => {
  assert.deepEqual(normalizeReversalNote(undefined), { ok: true, note: null });
  assert.deepEqual(normalizeReversalNote(null), { ok: true, note: null });
  assert.deepEqual(normalizeReversalNote('   \n\t '), { ok: true, note: null });
  assert.deepEqual(normalizeReversalNote('  옆   테이블\n손님과   바뀜  '), { ok: true, note: '옆 테이블 손님과 바뀜' });
  assert.deepEqual(normalizeReversalNote('a\u0000b​c‮d'), { ok: true, note: 'abcd' });
  assert.deepEqual(normalizeReversalNote('가'.repeat(100)), { ok: true, note: '가'.repeat(100) });
  assert.deepEqual(normalizeReversalNote('가'.repeat(101)), { ok: false });
  // 이모지 100개는 코드 포인트로 100자다.
  assert.deepEqual(normalizeReversalNote('😀'.repeat(100)), { ok: true, note: '😀'.repeat(100) });
  assert.deepEqual(normalizeReversalNote('😀'.repeat(101)), { ok: false });
  assert.deepEqual(normalizeReversalNote(42), { ok: false });
  assert.deepEqual(normalizeReversalNote({ note: 'x' }), { ok: false });
  for (const bad of ['문의 kim@example.com', '@kim_shop', 'https://example.com/x', 'www.example.com', '전화 010-1234-5678', '01012345678', '1234 5678']) {
    assert.deepEqual(normalizeReversalNote(bad), { ok: false }, bad);
  }
  // 짧은 숫자는 개인정보로 보지 않는다.
  assert.deepEqual(normalizeReversalNote('3번 테이블, 2명'), { ok: true, note: '3번 테이블, 2명' });
});

test('only real stores exclude a visit the staff member claimed for themselves', () => {
  const same = { slotCreatedByAccountId: 'staff-1', customerAccountId: 'staff-1' };
  assert.equal(isStaffSelfClaim({ merchantIsDemo: false, ...same }), true);
  assert.equal(isStaffSelfClaim({ merchantIsDemo: true, ...same }), false);
  assert.equal(isStaffSelfClaim({ merchantIsDemo: false, slotCreatedByAccountId: 'staff-1', customerAccountId: 'guest' }), false);
});

test('a mint job is cancelable only while nothing was sent and no worker holds a lease', () => {
  const base = { transactionHash: null, lastErrorCode: null, leased: false };
  for (const status of ['QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW']) {
    assert.equal(classifyMintJob({ ...base, status }), 'CANCELABLE', status);
    assert.equal(classifyMintJob({ ...base, status, leased: true }), 'IN_PROGRESS', status);
    assert.equal(classifyMintJob({ ...base, status, transactionHash: `0x${'a'.repeat(64)}` }), 'MINTED', status);
    assert.equal(classifyMintJob({ ...base, status, lastErrorCode: 'MINT_SUBMISSION_RESPONSE_LOST' }), 'MINTED', status);
    // 다른 오류 코드는 전송 여부와 무관하다.
    assert.equal(classifyMintJob({ ...base, status, lastErrorCode: 'RPC_TIMEOUT' }), 'CANCELABLE', status);
  }
  for (const status of ['SUBMITTED', 'CONFIRMING', 'FINALIZED']) {
    assert.equal(classifyMintJob({ ...base, status }), 'MINTED', status);
    assert.equal(classifyMintJob({ ...base, status, leased: true }), 'MINTED', status);
  }
  assert.equal(classifyMintJob({ ...base, status: 'CANCELLED' }), 'ALREADY_CANCELLED');
  assert.equal(classifyMintJob({ ...base, status: 'SOMETHING_NEW' }), 'MINTED');
});

test('entitlements are revoked when the visit made them or the recount no longer reaches them', () => {
  const entitlements = [
    { id: 'e1', targetVisitCount: 1, sourceVisitEventId: 'v1' },
    { id: 'e3', targetVisitCount: 3, sourceVisitEventId: 'v3' },
    { id: 'e5', targetVisitCount: 5, sourceVisitEventId: 'v5' },
  ];
  assert.deepEqual(selectEntitlementsToRevoke(entitlements, { visitEventId: 'v3', progressAfter: 2 }).map(({ id }) => id), ['e3', 'e5']);
  assert.deepEqual(selectEntitlementsToRevoke(entitlements, { visitEventId: 'v5', progressAfter: 4 }).map(({ id }) => id), ['e5']);
  // 다른 방문이 채워 주는 진행이 남아 있으면 그 방문이 만든 권리만 되돌린다.
  assert.deepEqual(selectEntitlementsToRevoke(entitlements, { visitEventId: 'v3', progressAfter: 5 }).map(({ id }) => id), ['e3']);
  assert.deepEqual(selectEntitlementsToRevoke(entitlements, { visitEventId: 'other', progressAfter: 5 }), []);
  assert.deepEqual(selectEntitlementsToRevoke(entitlements, { visitEventId: 'v1', progressAfter: 0 }).map(({ id }) => id), ['e1', 'e3', 'e5']);
});

test('boxes stay openable only while enough badges remain', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 8, 9].map(milestonesToVoid), [[1, 2, 3], [1, 2, 3], [2, 3], [2, 3], [3], [3], []]);
});

test('a coupon voided by a visit cancellation may be revived but an admin void may not', () => {
  assert.equal(isReissuableVoid({ status: 'VOIDED', voidReason: 'VISIT_CANCELED' }), true);
  assert.equal(isReissuableVoid({ status: 'VOIDED', voidReason: 'ABUSE_SUSPECTED' }), false);
  assert.equal(isReissuableVoid({ status: 'VOIDED', voidReason: null }), false);
  assert.equal(isReissuableVoid({ status: 'ISSUED', voidReason: 'VISIT_CANCELED' }), false);
  assert.equal(isReissuableVoid({ status: 'REDEEMED', voidReason: null }), false);
});

test('the masked customer label is stable per store, differs across stores and hides the account', () => {
  const secret = 'label-secret-at-least-32-bytes-long-000';
  const first = maskedCustomerLabel(secret, 'shop-a', 'acct_1234');
  assert.match(first, /^손님 [A-HJ-NP-Z2-9]{4}$/);
  assert.equal(first, maskedCustomerLabel(secret, 'shop-a', 'acct_1234'));
  assert.notEqual(first, maskedCustomerLabel(secret, 'shop-b', 'acct_1234'));
  assert.notEqual(first, maskedCustomerLabel('another-secret-at-least-32-bytes-000000', 'shop-a', 'acct_1234'));
  assert.equal(first.includes('acct'), false);
});
