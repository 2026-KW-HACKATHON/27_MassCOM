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

test('deletion page directs app users to email and identity verification instead of automatic deletion', () => {
  assert.match(page, /앱에서 요청 페이지 열기[\s\S]*이메일로 삭제 요청하기/);
  assert.match(page, /본인 확인이 끝나기 전에는 삭제가 실행되지 않습니다/);
  assert.doesNotMatch(page, /같은 Google 계정으로 다시 확인한 뒤 삭제를 접수합니다/);
});
