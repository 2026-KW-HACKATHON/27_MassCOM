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

test('the deletion notice in the app and on the web page both say the friends data is removed too', () => {
  assert.match(screen, /별명·친구 코드·친구 관계도 함께 지워져 친구 목록에서 사라집니다/);
  assert.match(page, /별명·친구 코드·친구 관계와 친구 끊기 기록/);
});
