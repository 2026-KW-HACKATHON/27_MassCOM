import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DeletionIntakeView } from './account-deletion-intake-api';
import { AccountDeletionIntakeApiError } from './account-deletion-intake-api';
import {
  canRequestShowcaseDeletion, describeDeletionIntake, formatKstMinute, intakeUnknownMessage, lookupFailureMessage,
  overdueMessage,
} from './deletion-intake-copy';

const view: DeletionIntakeView = {
  status: 'REQUESTED', requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z',
  dueAt: '2026-10-08T00:00:00.000Z', cancelledAt: null, processedAt: null, rejectReason: null, overdue: false, deletion: null,
};

test('only a showcase bearer session files a deletion inside the app', () => {
  const bearer = { kind: 'bearer', sessionToken: 'live' } as const;
  const demo = { kind: 'demo', accountId: 'dev', allowInsecureReauthentication: true } as const;
  assert.equal(canRequestShowcaseDeletion('kr.masscom.wolgye.demo', bearer), true);
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.dev', '', undefined, null]) {
    assert.equal(canRequestShowcaseDeletion(packageId, bearer), false, String(packageId));
  }
  assert.equal(canRequestShowcaseDeletion('kr.masscom.wolgye.demo', demo), false);
});

test('times are shown in Korea Standard Time to the minute', () => {
  assert.equal(formatKstMinute('2026-10-01T16:30:00.000Z'), '2026-10-02 01:30 KST');
  assert.equal(formatKstMinute('nope'), '-');
});

test('an active request is cancellable through the last millisecond of the window', () => {
  const inside = describeDeletionIntake(view, new Date('2026-10-01T12:00:00.000Z'));
  assert.equal(inside.title, '삭제 요청이 접수됐어요');
  assert.equal(inside.canCancel, true);
  assert.deepEqual(inside.lines, [
    '접수 2026-10-01 09:00 KST', '2026-10-02 09:00 KST까지 취소할 수 있습니다.', '처리 기한 2026-10-08 09:00 KST',
  ]);
  assert.equal(describeDeletionIntake(view, new Date('2026-10-02T00:00:00.000Z')).canCancel, true);
  const after = describeDeletionIntake(view, new Date('2026-10-02T00:00:00.001Z'));
  assert.equal(after.canCancel, false);
  assert.match(after.lines[1]!, /취소 기간이 지났습니다/);
});

test('a request still waiting after its 7 day deadline says so and never promises a date', () => {
  const late = describeDeletionIntake({ ...view, overdue: true }, new Date('2026-10-09T00:00:00.000Z'));
  assert.equal(late.title, '삭제 요청이 접수됐어요');
  assert.equal(late.lines.at(-1), '처리 기한이 지났어요. 문의해 주세요.');
  assert.equal(late.canCancel, false);
  assert.equal(describeDeletionIntake(view, new Date('2026-10-09T00:00:00.000Z')).lines.includes(overdueMessage), false);
});

test('finished requests never claim more than the server said', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  assert.match(describeDeletionIntake({ ...view, status: 'CANCELLED', cancelledAt: '2026-10-01T01:00:00.000Z' }, now).title, /삭제 요청을 취소했어요/);
  const rejected = describeDeletionIntake({ ...view, status: 'REJECTED', rejectReason: '본인 확인 불가' }, now);
  assert.match(rejected.lines[0]!, /본인 확인 불가/);
  assert.match(rejected.lines[1]!, /삭제되지 않았고/);
  const waiting = describeDeletionIntake({ ...view, status: 'PROCESSED',
    deletion: { status: 'WAITING_FOR_MINT_FINALITY', completedAt: null } }, now);
  assert.equal(waiting.title, '삭제 처리 중이에요');
  assert.match(waiting.lines[0]!, /완료라고 표시하지 않습니다/);
  const done = describeDeletionIntake({ ...view, status: 'PROCESSED',
    deletion: { status: 'COMPLETED', completedAt: '2026-10-03T00:00:00.000Z' } }, now);
  assert.equal(done.title, '삭제 처리가 끝났어요');
  for (const finished of [rejected, waiting, done]) assert.equal(finished.canCancel, false);
});

test('one term, 삭제 요청, names the request in every state and the lookup wording never over-claims', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  const states = [
    view,
    { ...view, status: 'CANCELLED' as const, cancelledAt: '2026-10-01T01:00:00.000Z' },
    { ...view, status: 'REJECTED' as const, rejectReason: '본인 확인 불가' },
    { ...view, status: 'PROCESSED' as const, deletion: null },
  ];
  for (const state of states) {
    const description = describeDeletionIntake(state, now);
    assert.doesNotMatch([description.title, ...description.lines].join(' '), /탈퇴/);
  }
  assert.equal(lookupFailureMessage(new AccountDeletionIntakeApiError(404, 'DELETION_RECEIPT_NOT_FOUND')),
    '접수번호를 확인할 수 없습니다. 입력을 다시 확인해 주세요.');
  assert.equal(lookupFailureMessage(new AccountDeletionIntakeApiError(429, 'DELETION_STATUS_RATE_LIMITED')),
    '조회가 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.');
  for (const other of [new AccountDeletionIntakeApiError(500, 'HTTP_500'), new TypeError('offline'), 'x']) {
    assert.equal(lookupFailureMessage(other), '지금은 상태를 확인할 수 없습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  assert.equal(intakeUnknownMessage, '접수 여부를 확인하지 못했어요. 다시 확인해 주세요.');
});
