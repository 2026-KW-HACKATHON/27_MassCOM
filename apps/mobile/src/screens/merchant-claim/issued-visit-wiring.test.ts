import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const staff = read('./staff.tsx');
const home = read('../merchant-home/index.tsx');
const status = read('../merchant-home/status.tsx');
const reversal = read('./staff-reversal.tsx');

test('발급 참조는 QR 닫기와 분리되고 새 발급·복구 성공은 추적기로 전달된다', () => {
  const cancel = staff.slice(staff.indexOf('function cancel()'), staff.indexOf('async function resolve('));
  assert.doesNotMatch(cancel, /issuedVisitController|setIssuedVisit/);
  for (const name of ['issue', 'reissue', 'recoverCurrent']) {
    const body = staff.slice(staff.indexOf(`async function ${name}(`));
    const end = body.indexOf('\n  }');
    assert.match(body.slice(0, end), /issuedVisitController.current\?\.issued\(next\)/);
  }
});

test('방문 확인 탭은 앱 복귀·탭 복귀·당겨서 새로 고침에 발급 상태를 다시 확인한다', () => {
  assert.match(staff, /AppState.addEventListener\('change'/);
  assert.match(staff, /if \(active\) void issuedVisitController.current\?\.refresh\(\)/);
  assert.match(staff, /<RefreshControl[^>]*onRefresh=\{\(\) => void refreshIssuedVisit\(\)\}/);
  assert.match(staff, /손님이 아직 받지 않았어요\. 잘못 만들었다면 그냥 닫으면 돼요\(코드는 곧 만료돼요\)/);
  assert.match(staff, /방금 방문이 확정됐어요/);
  assert.match(staff, /onVisitReversal\?\.\(visit\)/);
});

test('바로가기는 현황의 기존 취소 양식을 사전 선택하고 서버 취소를 직접 호출하지 않는다', () => {
  assert.match(home, /onVisitReversal=\{showVisitReversal\}/);
  assert.match(home, /setTab\('status'\)/);
  assert.match(status, /selectedVisit=\{selectedVisit\}/);
  assert.match(reversal, /preselectedCancelableVisit\(visits, selectedVisit, Date.now\(\)\)/);
  assert.match(reversal, /openVisitId: visit.visitEventId, reason: 'WRONG_CUSTOMER', note: ''/);
  assert.match(reversal, /Alert.alert\('방문 취소', cancelConfirmText\(visit\)/);
  assert.doesNotMatch(home, /\.cancelVisit\(/);
});
