import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');
const reversal = read('staff-reversal.tsx');
const staff = read('staff.tsx');

test('the staff screen shows the reversal cards before the issued claim QR so the QR stays the last card', () => {
  assert.match(staff, /<StaffReversalCards api=\{api\} merchantId=\{merchantId\} styles=\{styles\} \/>/);
  assert.ok(staff.indexOf('<StaffReversalCards') < staff.indexOf('{issued ? <View style={styles.tokenCard}>'));
  assert.match(staff, /scrollToEnd/);
});

test('cancelling a visit and undoing a coupon both ask first with a destructive confirmation', () => {
  assert.equal((reversal.match(/Alert\.alert\(/g) ?? []).length, 2);
  assert.equal((reversal.match(/style: 'destructive'/g) ?? []).length, 2);
  assert.match(reversal, /Alert\.alert\('방문 취소', cancelConfirmText\(visit\)/);
  assert.match(reversal, /Alert\.alert\('쿠폰 사용 되돌리기', undoConfirmText\(coupon\)/);
  // 확인 전에는 서버를 부르지 않는다: 요청은 경고창의 버튼 안에서만 시작한다.
  assert.match(reversal, /onPress: \(\) => void cancelVisit\(visit\)/);
  assert.match(reversal, /onPress: \(\) => void undoCoupon\(coupon\)/);
});

test('the reversal cards expose roles, live regions and the note limit and never touch account identifiers', () => {
  assert.match(reversal, /accessibilityRole="radiogroup"/);
  assert.match(reversal, /accessibilityRole="radio"/);
  assert.match(reversal, /accessibilityState=\{\{ selected \}\}/);
  assert.equal((reversal.match(/accessibilityLiveRegion="polite"/g) ?? []).length, 2);
  assert.match(reversal, /maxLength=\{reversalNoteMaxLength\}/);
  assert.match(reversal, /연락처·이메일·주소는 적지 마세요/);
  assert.doesNotMatch(reversal, /customerAccountId|accountId|email/i);
  // 처리 중에는 모든 버튼을 잠그고, 낡은 응답은 세대 번호로 버린다.
  assert.match(reversal, /disabled=\{busy\}/);
  assert.match(reversal, /if \(current === generation\.current\) applyLists\(results, keep\);/);
  assert.match(reversal, /if \(current === generation\.current\) applyLists\(results, \{\}\);/);
  assert.match(reversal, /return \(\) => \{ generation\.current \+= 1; \};/);
});

test('failures refresh a stale list and successes reload it while keeping the result message', () => {
  assert.match(reversal, /if \(staleAfterVisitFailure\(code\)\) await load\(\{ visits: true \}\);/);
  assert.match(reversal, /if \(staleAfterUndoFailure\(code\)\) await load\(\{ redemptions: true \}\);/);
  assert.match(reversal, /setVisitMessage\(cancelSuccessMessage\(result\)\);[\s\S]*await load\(\{ visits: true \}\);/);
  assert.match(reversal, /setRedemptionMessage\(undoSuccessMessage\(result\)\);[\s\S]*await load\(\{ redemptions: true \}\);/);
});
