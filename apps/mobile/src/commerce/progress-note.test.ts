import assert from 'node:assert/strict';
import { test } from 'node:test';

import { celebrationNote, progressNote } from './progress-note';

test('a counted visit keeps the existing wording', () => {
  assert.equal(progressNote({ progressCounted: true }), '오늘 방문이 진행 횟수에 반영됐습니다.');
  assert.equal(celebrationNote({ progressCounted: true }), '방문 도장이 도감에 찍혔어요.');
});

test('a same-day repeat keeps the daily-limit wording', () => {
  assert.equal(progressNote({ progressCounted: false }), '방문은 기록됐지만 같은 한국 날짜의 진행은 한 번만 셉니다.');
  assert.equal(celebrationNote({ progressCounted: false }), '방문은 기록됐어요. 같은 가게는 하루에 한 번만 배지에 세요.');
});

test('a staff self claim explains that it is recorded but never counted', () => {
  const visit = { progressCounted: false, progressExcludedReason: 'STAFF_SELF' as const };
  assert.match(progressNote(visit), /직원 본인 계정으로 받은 방문은 기록만 되고 진행·보상에는 세지 않습니다/);
  assert.match(celebrationNote(visit), /직원 본인 계정 방문은 배지·보상에 세지 않아요/);
  // 세어진 방문에는 이유가 붙어 있어도 세어졌다고 말한다.
  assert.equal(progressNote({ progressCounted: true, progressExcludedReason: 'STAFF_SELF' }), '오늘 방문이 진행 횟수에 반영됐습니다.');
});
