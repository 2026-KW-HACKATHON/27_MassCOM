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
