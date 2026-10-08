import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PendingShowcaseAccessRequest } from '@/commerce/commerce-api';
import { ADMIN_CONFIRM_TEXT, decideFailureMessage, listPendingFailureMessage, pendingRowText, staleAfterDecideFailure } from './copy';

const pending = (over: Partial<PendingShowcaseAccessRequest> = {}): PendingShowcaseAccessRequest => ({
  id: 'req-1', code: 'ABCDEFGH', createdAt: '2026-10-01T03:05:00.000Z', ...over,
});

test('a pending row shows the dashed code and the Korea-time it was requested', () => {
  assert.equal(pendingRowText(pending()), 'ABCD-EFGH · 12:05');
  assert.equal(pendingRowText(pending({ createdAt: '2026-10-01T15:00:00.000Z' })), 'ABCD-EFGH · 00:00');
});

test('the approve confirm text names the exact private practice-store staff grant', () => {
  assert.match(ADMIN_CONFIRM_TEXT, /비공개 체험 점주 가게 직원 권한/);
  assert.match(ADMIN_CONFIRM_TEXT, /수락할까요\?$/);
});

test('list failures are told apart from decision failures and every server code has its own Korean message', () => {
  assert.equal(listPendingFailureMessage(403, 'SHOWCASE_APPROVER_REQUIRED'), '이 계정에는 권한 요청을 볼 권한이 없어요.');
  assert.equal(listPendingFailureMessage(410, 'ACCOUNT_DELETED'), '계정이 삭제돼 처리할 수 없어요.');
  assert.equal(listPendingFailureMessage(500, 'HTTP_500'), '요청 목록을 불러오지 못했어요. 연결을 확인하고 다시 시도해 주세요.');

  assert.equal(decideFailureMessage(403, 'SHOWCASE_APPROVER_REQUIRED'), '이 계정에는 승인 권한이 없어요.');
  assert.equal(decideFailureMessage(403, 'SHOWCASE_ACCESS_SELF_DECISION'), '본인의 요청은 처리할 수 없어요.');
  assert.equal(decideFailureMessage(404, 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND'), '이미 처리됐거나 찾을 수 없는 요청이에요. 목록을 새로 불러왔어요.');
  assert.equal(decideFailureMessage(409, 'SHOWCASE_ACCESS_ALREADY_DECIDED'), '이미 처리된 요청이에요. 목록을 새로 불러왔어요.');
  assert.equal(decideFailureMessage(410, 'ACCOUNT_DELETED'), '계정이 삭제돼 처리할 수 없어요.');
  assert.equal(decideFailureMessage(500, 'HTTP_500'), '요청을 처리하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
});

test('a not-found or already-decided failure means the list is stale and should reload, others do not', () => {
  assert.deepEqual(
    ['SHOWCASE_ACCESS_REQUEST_NOT_FOUND', 'SHOWCASE_ACCESS_ALREADY_DECIDED', 'SHOWCASE_APPROVER_REQUIRED', 'SHOWCASE_ACCESS_SELF_DECISION'].map(staleAfterDecideFailure),
    [true, true, false, false],
  );
});
