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
  assert.match(screen, /Alert\.alert\(\s*reissue \? '접수번호 다시 받기' : '탈퇴 요청'/);
  assert.match(screen, /접수 후 24시간은 취소할 수 있고, 그 뒤 운영자가 7일 안에 처리합니다/);
  assert.match(screen, /접수만으로 계정이 바로 삭제되지는 않습니다/);
  assert.match(screen, /<Text selectable accessibilityLabel=\{`접수번호 \$\{receipt\.replaceAll\('-', ' '\)\}`\} style=\{styles\.receiptCode\}>/);
  assert.match(screen, /탈퇴 요청 취소 \(/);
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
