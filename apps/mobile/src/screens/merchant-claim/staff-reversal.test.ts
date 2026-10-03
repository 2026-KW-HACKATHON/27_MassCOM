import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
const reversal = read('staff-reversal.tsx');
const staff = read('staff.tsx');

test('reversal cards belong to the status tab and issued QR has its own full screen', () => {
  const status = readFileSync(fileURLToPath(new URL('../merchant-home/status.tsx', import.meta.url)), 'utf8');
  assert.match(status, /<StaffReversalCards api=\{commerce\} merchantId=\{merchantId\} styles=\{reversalStyles\} refreshSignal=\{reversalRefresh\} \/>/);
  assert.doesNotMatch(staff, /StaffReversalCards|scrollToEnd/);
  const modal = staff.slice(staff.indexOf('<Modal'), staff.indexOf('</Modal>'));
  assert.match(modal, /presentationStyle="fullScreen"/);
  assert.match(modal, /<ClaimQr code=\{issued.token\}/);
  assert.doesNotMatch(modal, /ScrollView/);
});

test('cancelling a visit and undoing a coupon both ask first with a destructive confirmation', () => {
  assert.equal((reversal.match(/Alert\.alert\(/g) ?? []).length, 2);
  assert.equal((reversal.match(/style: 'destructive'/g) ?? []).length, 2);
  assert.match(reversal, /Alert\.alert\('방문 취소', cancelConfirmText\(visit\)/);
  assert.match(reversal, /Alert\.alert\('쿠폰 사용 되돌리기', undoConfirmText\(coupon\)/);
  // 확인 전에는 서버를 부르지 않는다: 요청은 경고창의 버튼 안에서만 시작한다.
  assert.match(reversal, /onPress: \(\) => void cancelVisit\(visit\)/);
  assert.match(reversal, /onPress: \(\) => void controller\.current\?\.undoCoupon\(coupon\)/);
});

test('the reversal cards expose roles, live regions and the note limit and never touch account identifiers', () => {
  assert.match(reversal, /accessibilityRole="radiogroup"/);
  assert.match(reversal, /accessibilityRole="radio"/);
  assert.match(reversal, /accessibilityState=\{\{ selected \}\}/);
  assert.equal((reversal.match(/accessibilityLiveRegion="polite"/g) ?? []).length, 2);
  assert.match(reversal, /maxLength=\{reversalNoteMaxLength\}/);
  assert.match(reversal, /연락처·이메일·주소·이름은 적지 마세요/);
  assert.match(reversal, /연락처, 이메일, 주소, 이름은 적지 마세요/);
  assert.doesNotMatch(reversal, /customerAccountId|accountId|email/i);
  // 처리 중에는 모든 버튼을 잠근다.
  assert.match(reversal, /disabled=\{busy\}/);
});

// 요청 장부(낡은 응답 버리기·중복 누름 방지·점포 변경 시 목록 지우기)는 reversal-loader.ts로 옮겼고 reversal-loader.test.ts가 동작으로 시험한다.
// 화면이 그 장부만 쓰는지, 점포가 바뀌면 컨트롤러를 새로 만들고 이전 것을 닫는지, 두 카드에 새로 고침이 있는지 확인한다.
test('the screen delegates every request to the controller and rebuilds it when the store changes', () => {
  assert.match(reversal, /createReversalController\(api, merchantId, setState\)/);
  assert.match(reversal, /\}, \[api, merchantId\]\);/);
  assert.match(reversal, /void next\.start\(\);/);
  assert.match(reversal, /next\.dispose\(\);/);
  assert.match(reversal, /rawState\.merchantId === merchantId \? rawState : initialReversalState/);
  assert.match(reversal, /controller\.current\?\.cancelVisit\(visit, \{ reason, note \}\)/);
  assert.match(reversal, /controller\.current\?\.undoCoupon\(coupon\)/);
  assert.doesNotMatch(reversal, /api\.(listRecent|cancelVisit|undoCoupon)/);
  assert.match(reversal, /label="목록 새로 고침"/);
  assert.match(reversal, /label="쿠폰 목록 새로 고침"/);
  assert.equal((reversal.match(/controller\.current\?\.refresh\(\)/g) ?? []).length, 3);
  assert.match(reversal, /if \(refreshSignal > 0\) void controller\.current\?\.refresh\(\)/);
});
