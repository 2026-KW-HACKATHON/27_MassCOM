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
  // 리뷰 라운드 6에서 당겨서 새로고침·탭 포커스 재진입이 같은 규칙을 공유하도록 quietRefresh()로 뽑았다
  // (refresh()는 이제 그 결과만 기다린다).
  const quietRefreshFn = screen.slice(screen.indexOf('const quietRefresh ='), screen.indexOf('useFocusEffect('));
  assert.match(quietRefreshFn, /const refreshed = await shop\.refreshQuietly\(\);/);
  assert.match(quietRefreshFn, /if \(refreshed\) setPending\(undefined\);/);
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /await quietRefresh\(\);/);
});

test('PR #312 리뷰 라운드 6: 상점 탭이 다시 포커스를 받을 때마다 조용히 새로고침한다 — 다른 화면에서 번 마일리지가 돌아왔을 때 옛 잔액으로 남지 않는다', () => {
  // 기기 QA: 방문으로 마일리지를 번 뒤 상점 탭으로 돌아와도(탭은 마운트된 채로 남는다) 다시 포커스를 받을
  // 때까지는 처음 불러온 잔액이 그대로 보였다. use-shop-avatar-art.ts의 useFocusEffect와 같은 모양.
  assert.match(screen, /import \{ useFocusEffect \} from 'expo-router';/);
  assert.match(screen, /useFocusEffect\(useCallback\(\(\) => \{ void quietRefresh\(\); \}, \[quietRefresh\]\)\);/);
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
  assert.match(screen, /purchaseBusy=\{Boolean\(busyGrade\) \|\| avatarBusy\}/);
  const gradeRow = screen.slice(screen.indexOf('function GradeRow('), screen.indexOf('function FriendCell('));
  assert.match(gradeRow, /purchaseBusy: boolean/);
  assert.match(gradeRow, /const disabled = button\.disabled \|\| purchaseBusy;/);
  assert.match(gradeRow, /disabled=\{disabled\}/);
});

test('PR #312 리뷰 라운드 4: avatarBusy 동안에도 새 뽑기를 막는다 — 닫힌 모달의 대표 설정 실패가 새로 연 뽑기 모달 뒤에 숨지 않는다', () => {
  const buyFn = screen.slice(screen.indexOf('async function buy('), screen.indexOf('async function chooseAvatar('));
  assert.match(buyFn, /if \(busyGrade \|\| avatarBusy\) return;/);
});

test('PR #312 "대표 해제": 가진 친구는(대표든 아니든) 탭할 수 있고, 이미 대표면 해제를, 아니면 설정을 묻는다', () => {
  const confirmFn = screen.slice(screen.indexOf('function confirmAvatar('), screen.indexOf('const header ='));
  assert.match(confirmFn, /if \(!cell\.owned \|\| avatarBusy\) return;/);
  assert.match(confirmFn, /if \(cell\.isAvatar\) \{/);
  assert.match(confirmFn, /'대표 해제'/);
  assert.match(confirmFn, /onPress: \(\) => void chooseAvatar\(null\)/);
  assert.match(confirmFn, /onPress: \(\) => void chooseAvatar\(cell\.id\)/);
  assert.match(screen, /async function chooseAvatar\(itemId: string \| null, targetReveal\?: ShopRerollResult\)/);
  const friendCell = screen.slice(screen.indexOf('function FriendCell('));
  assert.match(friendCell, /accessibilityRole=\{cell\.owned \? 'button' : undefined\}/);
  assert.match(friendCell, /disabled=\{!cell\.owned\}/);
});

test('PR #312 리뷰 7번 + 2차 confirm-review: 대표 설정 성공·실패 둘 다, 그 응답이 시작된 모달이 아직 떠 있을 때만 그 모달을 건드린다', () => {
  // 그리드에서 바로 부르면(confirmAvatar) targetReveal이 없어 reveal을 전혀 건드리지 않는다 — 그 사이 열린
  // 전혀 다른 뽑기 결과 모달을 실수로 닫거나 그 안에 엉뚱한 실패를 적지 않는다(2차 confirm-review: "a delayed
  // avatar-set success closes a NEWER draw's result modal"). 뽑기 연출에서 부르면(reveal.item.id, reveal) 그
  // reveal 객체 자체를 넘겨, 응답이 왔을 때 revealRef.current가 여전히 그 객체일 때만 닫거나 실패를 적는다.
  const chooseFn = screen.slice(screen.indexOf('async function chooseAvatar('), screen.indexOf('function confirmAvatar('));
  assert.match(chooseFn, /if \(targetReveal && revealRef\.current === targetReveal\) setReveal\(undefined\);/);
  assert.match(chooseFn, /if \(targetReveal && revealRef\.current === targetReveal\) setAvatarError\(shopErrorMessage\(error\)\);/);
  assert.match(chooseFn, /else setNotice\(\{ tone: 'error', text: shopErrorMessage\(error\) \}\);/);
  assert.match(screen, /onSetAvatar=\{\(\) => void chooseAvatar\(reveal\.item\.id, reveal\)\}/);
  assert.match(screen, /avatarError=\{avatarError\}/);
  assert.match(screen, /onClose=\{\(\) => \{ setReveal\(undefined\); setAvatarError\(undefined\); \}\}/);
  assert.match(reveal, /avatarError\?: string;/);
  assert.match(reveal, /\{avatarError \? <Text accessibilityLiveRegion="polite"/);
});

test('cross-review 3번: revealRef는 reveal이 바뀔 때마다 동기화돼 늦게 끝난 요청이 낡은 모달 상태를 읽지 않는다', () => {
  assert.match(screen, /const revealRef = useRef\(reveal\);/);
  assert.match(screen, /useEffect\(\(\) => \{ revealRef\.current = reveal; \}, \[reveal\]\);/);
  const chooseFn = screen.slice(screen.indexOf('async function chooseAvatar('), screen.indexOf('function confirmAvatar('));
  assert.doesNotMatch(chooseFn, /if \(reveal\)/, 'catch/then은 reveal을 직접 읽으면 안 된다(요청 시작 시점의 낡은 값)');
});

test('PR #312 리뷰 라운드 4: 오류 화면의 중복 clearance spacer는 되돌렸다(근본 원인 불명 — 에뮬레이터 QA가 재현해서 실제 원인을 고친다)', () => {
  const errorBranch = screen.slice(screen.indexOf("shop.status === 'error'"), screen.indexOf(": sky(<StateScene kind=\"loading\""));
  assert.match(errorBranch, /<StateScene kind="error" title="상점을 불러오지 못했어요"/);
  assert.doesNotMatch(errorBranch, /<View style=\{\{ height: clearance \}\} \/>/, '100% 글자에서 섹션 간격+clearance만큼 빈 공간이 남는 중복 여백을 다시 넣지 않는다');
});

test('#314가 찾은 근본 원인(도감의 같은 sky()와 동일): 로딩→오류로 바뀌며 커진 내용을 다시 스크롤해 탭 바 밑 재시도 버튼을 보여준다', () => {
  // 로딩과 오류 두 갈래만 retryScroll을 켠다 — 성공 화면(아래 return sky(<>...))은 그대로 둬, 당겨서
  // 새로고침할 때 사용자 스크롤 위치를 건드리지 않는다(팀장 지시: "don't scroll users on normal refresh").
  assert.match(screen, /const skyScrollView = useRef<ScrollView>\(null\);/);
  const errorBranch = screen.slice(screen.indexOf("shop.status === 'error'"), screen.indexOf(": sky(<StateScene kind=\"loading\""));
  assert.match(errorBranch, /, undefined, true\)/);
  const loadingBranch = screen.slice(screen.indexOf(": sky(<StateScene kind=\"loading\""), screen.indexOf('if (!shop.snapshot)') + 500);
  assert.match(loadingBranch, /: sky\(<StateScene kind="loading" title="상점을 불러오는 중" \/>, undefined, true\);/);
  const successReturn = screen.slice(screen.indexOf('const { snapshot } = shop;'));
  assert.doesNotMatch(successReturn, /, true\)/, '성공 화면의 sky() 호출에는 retryScroll을 넘기지 않는다');

  const skyFn = screen.slice(screen.indexOf('const sky = (body'), screen.indexOf('if (!shop.snapshot)'));
  assert.match(skyFn, /retryScroll\?: boolean/);
  // ref를 함수 매개변수로 건네면 react-hooks/refs가 "렌더 중 ref를 읽을 수 있다"고 lint를 막는다 — 그래서
  // bool만 받고, 실제 ref는 이 컴포넌트 스코프의 skyScrollView를 클로저로 직접 읽는다.
  assert.match(skyFn, /ref=\{retryScroll \? skyScrollView : undefined\}/);
  // retryScroll이 꺼진 호출(성공 화면)에서는 onContentSizeChange를 아예 안 달아, 정상적인 당겨서 새로고침 때
  // 사용자가 보고 있던 위치로 되돌리지 않는다.
  assert.match(skyFn, /onContentSizeChange=\{retryScroll \? \(_width, height\) => \{/);
  // 이 자리의 scrollTo는 아무 효과가 없다 — 한 프레임 미뤄야 네이티브가 새 크기를 반영한다(#314 PR #320과 동일).
  assert.match(skyFn, /requestAnimationFrame\(\(\) => skyScrollView\.current\?\.scrollTo\(\{ y: height, animated: false \}\)\);/);
});

test('PR #312 QA: 뽑기 연출은 다른 화면의 모달들처럼 SkyBackdrop 안, SkyScrollView의 형제로 둔다(RefreshControl 중복 없이)', () => {
  const skyFn = screen.slice(screen.indexOf('const sky = (body'), screen.indexOf('if (!shop.snapshot)'));
  assert.match(skyFn, /<SkyBackdrop>\s*<SkyScrollView/);
  assert.match(skyFn, /<\/SkyScrollView>\s*\{extra\}\s*<\/SkyBackdrop>/, 'extra(모달)는 SkyScrollView 다음, 여전히 SkyBackdrop 안에 있다');
  assert.match(screen, /return sky\(\s*<>/, '성공 화면은 sky()의 두 번째 인자로 DrawReveal을 넘긴다(머리글·RefreshControl 중복 없음)');
  assert.match(screen, /<DrawReveal[\s\S]*?\/>\s*\) : null,\s*\);/);
  // RefreshControl 배선은 sky() 안에 한 번만 있다 — 되돌리면 중복돼 ui/components.test.ts의 전체 개수 시험이 깨진다.
  assert.equal((screen.match(/<RefreshControl/g) ?? []).length, 1);
});

test('PR #312 리뷰 6번: 구매 성공과 당겨서 새로고침 둘 다 사용 내역의 첫 페이지를 다시 불러오게 한다', () => {
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  const buySuccess = screen.slice(screen.indexOf('const result = await api.reroll'), screen.indexOf('} catch (error) {'));
  assert.match(buySuccess, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  assert.match(screen, /<HistorySection api=\{api\} refreshToken=\{historyRefreshToken\} \/>/);
});
