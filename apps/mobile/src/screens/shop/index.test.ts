import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 이 저장소에는 RN 컴포넌트 렌더러가 없어(AGENTS.md: "mobile tests cannot import .tsx") 상점 화면의 배선은
// 소스 본문을 직접 확인한다(navigation/primary-tabs.test.ts·ui/components.test.ts와 같은 방식). PR #312 cross-review
// 6건의 수정이 실제 소스에 있는지, 되돌리면 이 시험들이 바로 실패하는지로 회귀를 막는다.

const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const reveal = readFileSync(fileURLToPath(new URL('./draw-reveal.tsx', import.meta.url)), 'utf8');

test('PR #312 리뷰 2번: 새로고침이 서버 결과를 보여줬을 때만 대기 중인 구매 시도를 지운다 — 다음 탭은 새 requestId로 시작한다', () => {
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /const refreshed = await shop\.refreshQuietly\(\);/);
  assert.match(refreshFn, /if \(refreshed\) setPending\(undefined\);/);
});

test('PR #312 리뷰 4번: SHOP_STATE_CHANGED는 새로고침이 끝날 때까지 구매를 막고(실패하면 안내만 다르게), 성공 문구를 재사용한다', () => {
  const buyFn = screen.slice(screen.indexOf('async function buy('), screen.indexOf('async function chooseAvatar('));
  const stateChangedBranch = buyFn.slice(buyFn.indexOf("code === 'SHOP_STATE_CHANGED'"));
  // refreshQuietly를 await한 뒤에만 안내를 정하고, setBusyGrade(undefined)는 try/catch 밖의 finally에 있어
  // 이 await가 끝나기 전에는 버튼이 다시 켜지지 않는다.
  assert.match(stateChangedBranch, /const refreshed = await shop\.refreshQuietly\(\);/);
  assert.match(stateChangedBranch, /text: refreshed \? shopErrorMessage\(error\) : '[^']+'/);
  const finallyBlock = buyFn.slice(buyFn.indexOf('} finally {'));
  assert.match(finallyBlock, /setBusyGrade\(undefined\);/);
  // finally는 이 catch 블록 전체(그 안의 await 포함)가 끝난 뒤에만 실행된다 — try/catch 자체가 그 보장이다.
  assert.ok(buyFn.indexOf('} finally {') > buyFn.indexOf('const refreshed = await shop.refreshQuietly();'));
});

test('PR #312 리뷰 8번: 한 등급을 구매하는 동안 다른 등급 버튼도 모두 비활성화된다(조용히 무시되는 탭 방지)', () => {
  assert.match(screen, /purchaseBusy=\{Boolean\(busyGrade\)\}/);
  const gradeRow = screen.slice(screen.indexOf('function GradeRow('), screen.indexOf('function FriendCell('));
  assert.match(gradeRow, /purchaseBusy: boolean/);
  assert.match(gradeRow, /const disabled = button\.disabled \|\| purchaseBusy;/);
  assert.match(gradeRow, /disabled=\{disabled\}/);
});

test('PR #312 "대표 해제": 가진 친구는(대표든 아니든) 탭할 수 있고, 이미 대표면 해제를, 아니면 설정을 묻는다', () => {
  const confirmFn = screen.slice(screen.indexOf('function confirmAvatar('), screen.indexOf('const header ='));
  assert.match(confirmFn, /if \(!cell\.owned \|\| avatarBusy\) return;/);
  assert.match(confirmFn, /if \(cell\.isAvatar\) \{/);
  assert.match(confirmFn, /'대표 해제'/);
  assert.match(confirmFn, /onPress: \(\) => void chooseAvatar\(null\)/);
  assert.match(confirmFn, /onPress: \(\) => void chooseAvatar\(cell\.id\)/);
  assert.match(screen, /async function chooseAvatar\(itemId: string \| null\)/);
  const friendCell = screen.slice(screen.indexOf('function FriendCell('));
  assert.match(friendCell, /accessibilityRole=\{cell\.owned \? 'button' : undefined\}/);
  assert.match(friendCell, /disabled=\{!cell\.owned\}/);
});

test('PR #312 리뷰 7번: 뽑기 연출이 열려 있는 동안 대표 설정 실패는 그 모달 안에서 보여준다(뒤에 깔린 알림이 아님)', () => {
  const chooseFn = screen.slice(screen.indexOf('async function chooseAvatar('), screen.indexOf('function confirmAvatar('));
  assert.match(chooseFn, /if \(reveal\) setAvatarError\(shopErrorMessage\(error\)\);/);
  assert.match(chooseFn, /else setNotice\(\{ tone: 'error', text: shopErrorMessage\(error\) \}\);/);
  assert.match(screen, /avatarError=\{avatarError\}/);
  assert.match(screen, /onClose=\{\(\) => \{ setReveal\(undefined\); setAvatarError\(undefined\); \}\}/);
  assert.match(reveal, /avatarError\?: string;/);
  assert.match(reveal, /\{avatarError \? <Text accessibilityLiveRegion="polite"/);
});

test('PR #312 리뷰 6번: 구매 성공과 당겨서 새로고침 둘 다 사용 내역의 첫 페이지를 다시 불러오게 한다', () => {
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  const buySuccess = screen.slice(screen.indexOf('const result = await api.reroll'), screen.indexOf('} catch (error) {'));
  assert.match(buySuccess, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  assert.match(screen, /<HistorySection api=\{api\} refreshToken=\{historyRefreshToken\} \/>/);
});
