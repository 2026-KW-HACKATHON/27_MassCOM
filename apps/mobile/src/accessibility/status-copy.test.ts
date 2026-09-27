import assert from 'node:assert/strict';
import { test } from 'node:test';

import { statusAnnouncement, type StatusAnnouncementKind } from './status-copy';

const cases: [StatusAnnouncementKind, Record<string, string> | undefined, RegExp][] = [
  ['login-restoring', undefined, /로그인/],
  ['login-failed', undefined, /다시 시도/],
  ['claim-preview', { merchantName: '월계 밥상', campaignTitle: '월계 한 바퀴' }, /방문 수령/],
  ['claim-replayed', { merchantName: '월계 밥상' }, /복구/],
  ['collection-binding-outage', undefined, /외부 지갑 주소 확인/],
  ['polling-paused', undefined, /NFT 등록/],
  ['polling-recovered', undefined, /다시 확인/],
  ['wallet-verified', undefined, /외부 지갑 주소 확인/],
  ['wallet-disconnected', undefined, /연결.*해제/],
  ['logout-complete', undefined, /로그아웃/],
  ['account-switch-complete', undefined, /계정/],
  ['deletion-blocked', undefined, /삭제.*아직/],
];

for (const [kind, context, expected] of cases) {
  test(`${kind} uses actionable user-facing copy`, () => {
    const copy = statusAnnouncement(kind, context);
    assert.match(copy, expected);
    assert.doesNotMatch(copy, /merchant-|campaign-|binding-|job-|SESSION_|[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });
}

test('uninvited showcase login asks for an invited account rather than blaming the network', () => {
  const copy = statusAnnouncement('login-failed', { reason: 'ACCOUNT_NOT_INVITED' });
  assert.match(copy, /초대된.*계정/);
  assert.doesNotMatch(copy, /네트워크|토큰|이메일/);
});

test('a cancelled Google picker remains a user-controlled retry', () => {
  const copy = statusAnnouncement('login-failed', { reason: 'GOOGLE_SIGN_IN_CANCELLED' });
  assert.match(copy, /취소/);
  assert.match(copy, /다시/);
});

test('only a true connection failure suggests checking the network', () => {
  assert.match(statusAnnouncement('login-failed', { reason: 'NETWORK_ERROR' }), /네트워크/);
  assert.doesNotMatch(statusAnnouncement('login-failed', { reason: 'GOOGLE_SIGN_IN_FAILED' }), /네트워크/);
  assert.match(statusAnnouncement('login-failed', { reason: 'LOGIN_RATE_LIMITED' }), /잠시 후/);
});
