import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ShowcaseAccessRequest } from '@/commerce/commerce-api';
import { ACCESS_CONTACT_ADDRESSES, accessMailtoUrl, accessUiState, formatAccessCode, requestAccessFailureMessage } from './access-copy';

const request = (over: Partial<ShowcaseAccessRequest> = {}): ShowcaseAccessRequest => ({
  code: 'ABCDEFGH', status: 'PENDING', createdAt: '2026-10-01T00:00:00.000Z', decidedAt: null, ...over,
});

test('the undashed server code is shown as two groups of four', () => {
  assert.equal(formatAccessCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.equal(formatAccessCode('short'), 'short', 'an unexpected length is shown as-is rather than mangled');
});

test('no request means the contact button, each status maps to its own screen state', () => {
  assert.deepEqual(accessUiState(null), { kind: 'none' });
  assert.deepEqual(accessUiState(request()), { kind: 'pending', code: 'ABCD-EFGH' });
  assert.deepEqual(accessUiState(request({ status: 'APPROVED' })), { kind: 'approved', code: 'ABCD-EFGH' });
  assert.deepEqual(accessUiState(request({ status: 'REJECTED' })), { kind: 'rejected', code: 'ABCD-EFGH' });
});

test('the mailto link addresses both reviewers and carries the same dashed code in subject and body', () => {
  const url = accessMailtoUrl('ABCDEFGH');
  assert.ok(url.startsWith('mailto:msocs1324@gmail.com,priestess4637@gmail.com?'));
  assert.match(url, /subject=%5BMassCOM%20%EC%8B%9C%EC%97%B0%5D/);
  assert.match(decodeURIComponent(url), /점주 체험 권한 요청 ABCD-EFGH/);
  assert.match(decodeURIComponent(url), /요청 번호: ABCD-EFGH/);
  assert.deepEqual(ACCESS_CONTACT_ADDRESSES, ['msocs1324@gmail.com', 'priestess4637@gmail.com']);
});

test('every request failure has a specific Korean message and the rate limit wins over the body code', () => {
  assert.equal(requestAccessFailureMessage(429, 'SHOWCASE_ACCESS_RATE_LIMITED'), '잠시 후 다시 시도해 주세요.');
  assert.equal(requestAccessFailureMessage(undefined, 'SHOWCASE_ACCESS_RATE_LIMITED'), '잠시 후 다시 시도해 주세요.');
  assert.equal(requestAccessFailureMessage(409, 'SHOWCASE_ACCESS_ALREADY_GRANTED'), '이미 점주 체험 권한이 있어요. 화면을 새로고침해 주세요.');
  assert.equal(requestAccessFailureMessage(410, 'ACCOUNT_DELETED'), '계정이 삭제돼 처리할 수 없어요.');
  assert.equal(requestAccessFailureMessage(500, 'HTTP_500'), '문의를 보내지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
});
