import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DeletionIntakeView } from './account-deletion-intake-api';
import { canRequestShowcaseDeletion, describeDeletionIntake, formatKstMinute } from './deletion-intake-copy';

const view: DeletionIntakeView = {
  status: 'REQUESTED', requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z',
  dueAt: '2026-10-08T00:00:00.000Z', cancelledAt: null, processedAt: null, rejectReason: null, deletion: null,
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
  assert.equal(inside.title, '탈퇴 요청이 접수됐어요');
  assert.equal(inside.canCancel, true);
  assert.deepEqual(inside.lines, [
    '접수 2026-10-01 09:00 KST', '2026-10-02 09:00 KST까지 취소할 수 있습니다.', '처리 기한 2026-10-08 09:00 KST',
  ]);
  assert.equal(describeDeletionIntake(view, new Date('2026-10-02T00:00:00.000Z')).canCancel, true);
  const after = describeDeletionIntake(view, new Date('2026-10-02T00:00:00.001Z'));
  assert.equal(after.canCancel, false);
  assert.match(after.lines[1]!, /취소 기간이 지났습니다/);
});

test('finished requests never claim more than the server said', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  assert.match(describeDeletionIntake({ ...view, status: 'CANCELLED', cancelledAt: '2026-10-01T01:00:00.000Z' }, now).title, /취소했어요/);
  const rejected = describeDeletionIntake({ ...view, status: 'REJECTED', rejectReason: '본인 확인 불가' }, now);
  assert.match(rejected.lines[0]!, /본인 확인 불가/);
  assert.match(rejected.lines[1]!, /삭제되지 않았고/);
  const waiting = describeDeletionIntake({ ...view, status: 'PROCESSED',
    deletion: { status: 'WAITING_FOR_MINT_FINALITY', completedAt: null, pendingMintJobs: 1, retainedFinalizedNfts: 0 } }, now);
  assert.equal(waiting.title, '탈퇴 처리 중이에요');
  assert.match(waiting.lines[0]!, /완료라고 표시하지 않습니다/);
  const done = describeDeletionIntake({ ...view, status: 'PROCESSED',
    deletion: { status: 'COMPLETED', completedAt: '2026-10-03T00:00:00.000Z', pendingMintJobs: 0, retainedFinalizedNfts: 0 } }, now);
  assert.equal(done.title, '탈퇴 처리가 끝났어요');
  for (const finished of [rejected, waiting, done]) assert.equal(finished.canCancel, false);
});
