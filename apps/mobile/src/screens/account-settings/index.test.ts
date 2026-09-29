import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../../../../docs/account-deletion.html', import.meta.url), 'utf8');

test('blocked account deletion offers the HTTPS request page with a link role and open failure feedback', () => {
  assert.match(screen, /https:\/\/www\.masscom\.kr\/account-deletion/);
  assert.match(screen, /웹에서 계정 삭제 요청/);
  assert.match(screen, /accessibilityRole="link"/);
  assert.match(screen, /Linking\.openURL/);
  assert.match(screen, /삭제 요청 페이지를 열지 못했습니다/);
});

test('deletion page directs app users to account-bound intake without claiming automatic deletion', () => {
  assert.match(page, /앱에서 요청 페이지 열기[\s\S]*Google 계정으로 로그인/);
  assert.match(page, /계정 삭제 요청 접수/);
  assert.match(page, /접수만으로 계정이나 보상 기록은 삭제되지 않습니다/);
  assert.match(page, /최근 5분 이내 재인증/);
  assert.match(page, /문의 이메일/);
  assert.doesNotMatch(page, /같은 Google 계정으로 다시 확인한 뒤 삭제를 접수합니다/);
});

test('the operating app copy names the Google web login, the receipt, 24 hours and 7 days, not an email request', () => {
  assert.doesNotMatch(screen, /웹에서 이메일로/);
  assert.match(screen, /웹에서 Google 로그인으로 본인을 확인한 뒤 삭제를 요청할 수 있습니다/);
  assert.match(screen, /접수번호를 받고, 24시간 안에는 취소할 수 있으며, 그 뒤 운영자가 7일 안에 처리합니다/);
  assert.match(screen, /처리 결과는 접수번호로 확인합니다/);
  assert.match(screen, /앱 내 자동 삭제를 사용할 수 없어요/);
});

test('only the showcase package files a deletion inside the app, after a confirmation, and shows a selectable receipt', () => {
  assert.match(screen, /canRequestShowcaseDeletion\(Application\.applicationId, credential\)/);
  assert.match(screen, /: intakeClient \? \(/);
  assert.match(screen, /Alert\.alert\(\s*reissue \? '접수번호 다시 받기' : '삭제 요청'/);
  assert.match(screen, /접수 후 24시간은 취소할 수 있고, 그 뒤 운영자가 7일 안에 처리합니다/);
  assert.match(screen, /접수만으로 계정이 바로 삭제되지는 않습니다/);
  // One line only: the receipt is shown once and a wrapped last character is easy to miss when copying it (#248).
  assert.match(screen, /<Text\s+selectable\s+accessibilityLabel=\{`접수번호 \$\{receipt\.replaceAll\('-', ' '\)\}`\}\s+adjustsFontSizeToFit\s+numberOfLines=\{1\}\s+maxFontSizeMultiplier=\{1\.3\}\s+style=\{styles\.receiptCode\}\s*>/);
  assert.match(screen, /삭제 요청 취소 \(/);
  assert.match(screen, /접수번호 다시 받기/);
  // The receipt lives in component state only.
  assert.doesNotMatch(screen, /AsyncStorage|SecureStore|localStorage/);
  // The blocked direct deletion stays blocked: filing never calls the D-026 deletion client.
  const fileIntake = screen.slice(screen.indexOf('async function fileIntake'), screen.indexOf('async function cancelIntake'));
  assert.doesNotMatch(fileIntake, /client\.requestDeletion|onLogout/);
});


test('the deletion notice in the app and on the web page both say the friends data is removed too', () => {
  assert.match(screen, /별명·친구 코드·친구 관계도 함께 지워져 친구 목록에서 사라집니다/);
  assert.match(page, /별명·친구 코드·친구 관계와 친구 끊기 기록/);
});

test('one term, 삭제 요청, is used and the failure copy no longer claims a filing did not happen', () => {
  assert.doesNotMatch(screen, /탈퇴/);
  assert.doesNotMatch(screen, /접수되었다고 간주하지 않으니/);
  assert.match(screen, /<Text style=\{styles\.sectionTitle\}>계정 삭제 요청<\/Text>/);
});

test('an ambiguous failure while filing, re-issuing or cancelling asks the server again instead of guessing', () => {
  const fileIntake = screen.slice(screen.indexOf('async function fileIntake'), screen.indexOf('async function cancelIntake'));
  assert.match(fileIntake, /isAmbiguousIntakeFailure\(caught\)\) await settleAmbiguousFailure\(reissue \? 'reissue' : 'file'\)/);
  const cancelIntake = screen.slice(screen.indexOf('async function cancelIntake'), screen.indexOf('function confirmDeletion'));
  assert.match(cancelIntake, /isAmbiguousIntakeFailure\(caught\)\) await settleAmbiguousFailure\('cancel'\)/);
  const settle = screen.slice(screen.indexOf('async function settleAmbiguousFailure'), screen.indexOf('async function lookUpReceipt'));
  assert.match(settle, /recheckIntake\(intakeClient\)/);
  assert.match(settle, /setIntake\(undefined\);\s*setIntakeUnknown\(true\)/);
  assert.match(screen, /intakeUnknownMessage/);
});

test('a failed status load offers a retry instead of staying on loading forever', () => {
  const load = screen.slice(screen.indexOf('useEffect(() => {\n    if (!intakeClient)'), screen.indexOf('function checkIntakeAgain'));
  assert.match(load, /\(\) => \{ if \(current\) setIntakeUnknown\(true\); \}/);
  assert.match(load, /\[intakeClient, loadAttempt\]/);
  assert.match(screen, /intake === undefined && intakeUnknown/);
  assert.match(screen, /setLoadAttempt\(\(attempt\) => attempt \+ 1\)/);
  assert.match(screen, /<Text style=\{styles\.secondaryLinkText\}>다시 확인<\/Text>/);
});

test('the showcase screen looks a receipt up through the client and shows only the described state', () => {
  assert.match(screen, /await intakeClient\.status\(lookupCode\.trim\(\)\)/);
  assert.match(screen, /accessibilityLabel="접수번호"/);
  assert.match(screen, /처리 상태 확인/);
  assert.match(screen, /lookupFailureMessage\(caught\)/);
  assert.match(screen, /autoCapitalize="characters"/);
  const lookup = screen.slice(screen.indexOf('async function lookUpReceipt'), screen.indexOf('function confirmIntake'));
  assert.doesNotMatch(lookup, /AsyncStorage|SecureStore|localStorage/);
});
