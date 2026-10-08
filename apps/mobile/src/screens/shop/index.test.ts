import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// 이 저장소에는 RN 컴포넌트 렌더러가 없어(AGENTS.md: "mobile tests cannot import .tsx") 상점 화면의 배선은
// 소스 본문을 직접 확인한다(navigation/primary-tabs.test.ts·ui/components.test.ts와 같은 방식). PR #312 cross-review
// 6건의 수정이 실제 소스에 있는지, 되돌리면 이 시험들이 바로 실패하는지로 회귀를 막는다.

const screen = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const machine = readFileSync(fileURLToPath(new URL('./gacha-machine.tsx', import.meta.url)), 'utf8');

test('confirmed grade draws and their replay update the shop header from the server balance', () => {
  const recovery = screen.slice(screen.indexOf('const result = await drawApiRef.current.draw(stored);'), screen.indexOf('} catch (error)', screen.indexOf('const result = await drawApiRef.current.draw(stored);')));
  const purchase = screen.slice(screen.indexOf('async function buyGrade('), screen.indexOf('} catch (error)', screen.indexOf('async function buyGrade(')));
  assert.match(recovery, /shopRef\.current\.applyBalance\(result\.balance\)/);
  assert.match(purchase, /shop\.applyBalance\(result\.balance\)/);
  for (const source of [recovery, purchase]) assert.match(source, /setStoredDrawShop\(\(previous\) => previous\?\.key === drawScopeKey[\s\S]*?balance: result\.balance/);
  for (const source of [recovery, purchase]) assert.match(source, /void refreshDrawShop\(\)/);
  assert.match(screen, /mileageBalance=\{drawShop\?\.balance \?\? shop\.snapshot\?\.mileage\.balance\}/);
  const strip = readFileSync(fileURLToPath(new URL('../../ui/profile-strip.tsx', import.meta.url)), 'utf8');
  assert.match(strip, /const shownBalance = mileageBalance \?\? data\.shop\?\.mileage\.balance/);
  assert.match(strip, /마일리지 \$\{shownBalance\} 포인트, 상점/);
});

test('가구 구매 성공 잔액은 상점과 등급 뽑기에 즉시 반영되고 낡은 조회는 버린다', () => {
  const buyFurniture = screen.slice(screen.indexOf('async function buyFurniture('), screen.indexOf('const drawScopeKey ='));
  assert.match(buyFurniture, /shop\.applyBalance\(result\.balance\)/);
  assert.match(buyFurniture, /setStoredDrawShop\(\(previous\) => previous\?\.key === drawScopeKey[\s\S]*?balance: result\.balance/);
  assert.match(buyFurniture, /void refreshDrawShop\(\)/);
  assert.match(screen, /drawRequestGeneration\.current/);
});

test('가구 구매가 첫 등급 목록 조회보다 먼저 끝나도 등급 목록과 새 잔액을 표시한다', async () => {
  const refreshSource = screen.slice(screen.indexOf('const refreshDrawShop = useCallback('), screen.indexOf('useEffect(() => {\n    const timer', screen.indexOf('const refreshDrawShop =')));
  const purchaseSource = screen.slice(screen.indexOf('shop.applyBalance(result.balance);'), screen.indexOf('await clearFurniturePending(furnitureKey);'));
  type Stored = { key: string; value: { balance: number } };
  let stored: Stored | undefined;
  let finishOld: (value: { balance: number }) => void = () => {};
  let gets = 0;
  const drawApi = { getShop: () => {
    gets += 1;
    return gets === 1 ? new Promise<{ balance: number }>((resolve) => { finishOld = resolve; }) : Promise.resolve({ balance: 200 });
  } };
  const deps = {
    useCallback: (fn: unknown) => fn, drawApi, drawApiRef: { current: drawApi }, drawRequestGeneration: { current: 0 },
    drawScopeKey: 'account-1', shop: { applyBalance: () => {} }, shopErrorMessage: () => '', setStoredDrawError: () => {},
    setStoredDrawShop: (update: Stored | ((previous: Stored | undefined) => Stored | undefined)) => {
      stored = typeof update === 'function' ? update(stored) : update;
    },
  };
  const actions = new Function('deps', `with (deps) { ${refreshSource}; return { refreshDrawShop, purchase: (result) => { ${purchaseSource} } }; }`)(deps) as
    { refreshDrawShop: () => Promise<boolean>; purchase: (result: { balance: number }) => void };
  const oldGet = actions.refreshDrawShop();
  actions.purchase({ balance: 200 });
  finishOld({ balance: 400 });
  assert.equal(await oldGet, false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(gets, 2);
  assert.equal(stored?.value.balance, 200);
});

test('등급 뽑기 요청 오류는 같은 요청 복구와 닫기를 다시 허용한다', () => {
  const draw = readFileSync(fileURLToPath(new URL('./grade-draw-machine.tsx', import.meta.url)), 'utf8');
  assert.match(draw, /onRecover \? <Control label="이전 뽑기 결과 다시 확인"/);
  const startSource = draw.slice(draw.indexOf('const start = async () => {'), draw.indexOf('const displayedBalance ='));
  const run = new Function('onDraw', 'onClose', 'setPhase', 'setCloseNotice', 'crank', 'jiggle', 'openingScale', 'pool', 'balance', 'busy', 'phase',
    `${startSource}; return { start, close };`) as (...args: unknown[]) => { start: () => Promise<void>; close: () => void };
  let phase = 'detail';
  let closed = false;
  let drawing = false;
  const setPhase = (value: string) => { phase = value; };
  const drawPromise = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), 0); });
  const common = [() => { drawing = true; return drawPromise; }, () => { closed = true; }, setPhase, () => {}, { set: () => {} }, { set: () => {} }, { set: () => {} }, { total: 1, price: 100 }, 200];
  const active = run(...common, false, phase);
  const pending = active.start();
  assert.equal(drawing, true);
  assert.equal(phase, 'pending');
  return pending.then(() => {
    assert.equal(phase, 'detail');
    run(...common, false, phase).close();
    assert.equal(closed, true);
  });
});

test('GET refresh does not clear unresolved POST pending; only replay success/state-change handling clears storage', () => {
  const quietRefreshFn = screen.slice(screen.indexOf('const quietRefresh ='), screen.indexOf('useFocusEffect(', screen.indexOf('const quietRefresh =')));
  assert.match(screen, /const refreshGachaSnapshot = shop\.refreshQuietly;/);
  assert.match(quietRefreshFn, /refreshGachaSnapshot\(\)/);
  assert.match(quietRefreshFn, /\[refreshGachaSnapshot\]/);
  assert.doesNotMatch(quietRefreshFn, /shop\.refreshQuietly\(\)|\[shop\]/);
  assert.doesNotMatch(quietRefreshFn, /setPending\(undefined\)|clearPendingPurchase/);
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /await quietRefresh\(\);/);
});
test('focused quiet refresh executes the actual source callback wiring and settles with fresh shop aggregates', () => {
  const refreshSource = screen.match(/const refreshGachaSnapshot = shop\.refreshQuietly;/)?.[0];
  const quietSource = screen.match(/const quietRefresh = useCallback\(async \(\) => refreshGachaSnapshot\(\), \[refreshGachaSnapshot\]\);/)?.[0];
  const focusSource = screen.match(/useFocusEffect\(useCallback\(\(\) => \{ void quietRefresh\(\); void refreshDrawShop\(\); \}, \[quietRefresh, refreshDrawShop\]\)\);/)?.[0];
  assert.ok(refreshSource);
  assert.ok(quietSource);
  assert.ok(focusSource);

  let aggregateGetCount = 0;
  const stableRefreshQuietly = () => { aggregateGetCount += 1; return Promise.resolve(true); };
  const refreshDrawShop = () => Promise.resolve(true);
  void refreshDrawShop;
  let hookIndex = 0;
  let focusCallback: (() => void) | undefined;
  const hookSlots: { deps: readonly unknown[]; value: unknown }[] = [];
  const useCallback = <T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]): T => {
    const index = hookIndex;
    hookIndex += 1;
    const previous = hookSlots[index];
    if (previous && deps.length === previous.deps.length && deps.every((dep, depIndex) => Object.is(dep, previous.deps[depIndex]))) return previous.value as T;
    hookSlots[index] = { deps, value: callback };
    return callback;
  };
  const useFocusEffect = (callback: () => void) => { focusCallback = callback; };
  let previousFocusedCallback: (() => void) | undefined;
  const renderWhileFocused = () => {
    hookIndex = 0;
    const shop = { refreshQuietly: stableRefreshQuietly };
    let refreshGachaSnapshot!: typeof stableRefreshQuietly;
    let quietRefresh!: () => Promise<boolean>;
    eval(refreshSource.replace('const refreshGachaSnapshot =', 'refreshGachaSnapshot ='));
    eval(quietSource.replace('const quietRefresh =', 'quietRefresh ='));
    eval(focusSource);
    void useCallback;
    void useFocusEffect;
    void shop;
    void refreshGachaSnapshot;
    void quietRefresh;
    if (focusCallback && previousFocusedCallback !== focusCallback) {
      previousFocusedCallback = focusCallback;
      focusCallback();
    }
  };

  renderWhileFocused();
  renderWhileFocused();
  renderWhileFocused();
  assert.equal(aggregateGetCount, 1, 'actual source callback identity must settle after one focused GET despite fresh shop objects');

  previousFocusedCallback = undefined;
  renderWhileFocused();
  assert.equal(aggregateGetCount, 2, 'a later focus entry refreshes exactly once');
});

test('PR #312 리뷰 라운드 6: 상점 탭이 다시 포커스를 받을 때마다 조용히 새로고침한다 — 다른 화면에서 번 마일리지가 돌아왔을 때 옛 잔액으로 남지 않는다', () => {
  // 기기 QA: 방문으로 마일리지를 번 뒤 상점 탭으로 돌아와도(탭은 마운트된 채로 남는다) 다시 포커스를 받을
  // 때까지는 처음 불러온 잔액이 그대로 보였다. use-shop-avatar-art.ts의 useFocusEffect와 같은 모양.
  assert.match(screen, /import \{ useFocusEffect, useRouter \} from 'expo-router';/);
  assert.match(screen, /useFocusEffect\(useCallback\(\(\) => \{ void quietRefresh\(\); void refreshDrawShop\(\); \}, \[quietRefresh, refreshDrawShop\]\)\);/);
});
test('buy source body fails closed when pending read is unavailable before any write or POST', async () => {
  const buyFn = screen.slice(screen.indexOf('async function buy('), screen.indexOf('async function chooseAvatar('));
  const readLine = buyFn.match(/const storedAttempt = await readPendingPurchase\(pendingScope\);/)?.[0];
  const attemptLine = buyFn.match(/const attempt = storedAttempt \?\? resumeOrStartPurchase\(pending, grade\.grade\);/)?.[0];
  const writeLine = buyFn.match(/if \(!storedAttempt\) await writePendingPurchase\(pendingScope, \{ grade: attempt\.grade, requestId: attempt\.requestId, expectedRemaining: grade\.remaining \}\);/)?.[0];
  const rerollLine = buyFn.match(/const result = await api\.reroll\(\{ grade: attempt\.grade, requestId: attempt\.requestId, expectedRemaining \}\);/)?.[0];
  assert.ok(readLine);
  assert.ok(attemptLine);
  assert.ok(writeLine);
  assert.ok(rerollLine);

  const executeBuyCore = new Function(
    'readPendingPurchase', 'writePendingPurchase', 'resumeOrStartPurchase', 'api', 'pendingScope', 'pending', 'grade',
    `return (async () => { ${readLine} ${attemptLine} ${writeLine} const expectedRemaining = storedAttempt?.expectedRemaining ?? grade.remaining; ${rerollLine} return result; })();`,
  ) as (
    readPendingPurchase: () => Promise<unknown>,
    writePendingPurchase: () => Promise<void>,
    resumeOrStartPurchase: () => unknown,
    api: { reroll: () => Promise<unknown> },
    pendingScope: unknown,
    pending: unknown,
    grade: { grade: string; remaining: number },
  ) => Promise<unknown>;
  let writes = 0;
  let posts = 0;
  await assert.rejects(
    () => executeBuyCore(
      async () => { throw new Error('storage unavailable'); },
      async () => { writes += 1; },
      () => ({ grade: 'GOLD', requestId: 'new-request' }),
      { reroll: async () => { posts += 1; return {}; } },
      {},
      undefined,
      { grade: 'GOLD', remaining: 3 },
    ),
    /storage unavailable/,
  );
  assert.equal(writes, 0, 'buy must not overwrite unresolved pending when storage state is unknown');
  assert.equal(posts, 0, 'buy must not POST a fresh request when storage state is unknown');
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
  assert.match(screen, /purchaseBusy=\{Boolean\(busyGrade\) \|\| avatarBusy \|\| experience\.saving\}/);
  const gradeRow = screen.slice(screen.indexOf('function GradeRow('), screen.indexOf('function FriendCell('));
  assert.match(gradeRow, /purchaseBusy: boolean/);
  assert.match(gradeRow, /const disabled = button\.disabled \|\| purchaseBusy;/);
  assert.match(gradeRow, /disabled=\{disabled\}/);
});

test('PR #312 리뷰 라운드 4: avatarBusy 동안에도 새 뽑기를 막는다 — 닫힌 모달의 대표 설정 실패가 새로 연 뽑기 모달 뒤에 숨지 않는다', () => {
  const buyFn = screen.slice(screen.indexOf('async function buy('), screen.indexOf('async function chooseAvatar('));
  assert.match(buyFn, /if \(busyGrade \|\| avatarBusy \|\| experience\.saving\) return false;/);
});

test('PR #312 "대표 해제": 가진 친구는(대표든 아니든) 탭할 수 있고, 이미 대표면 해제를, 아니면 설정을 묻는다', () => {
  const confirmFn = screen.slice(screen.indexOf('function confirmAvatar('), screen.indexOf('const header ='));
  assert.match(confirmFn, /if \(!cell\.owned \|\| avatarBusy\) return;/);
  assert.match(confirmFn, /if \(cell\.isAvatar\) \{/);
  assert.match(confirmFn, /'동행 해제'/);
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
  assert.match(chooseFn, /if \(targetReveal && revealRef\.current === targetReveal\) \{\s*setReveal\(undefined\);\s*setMachineOpen\(false\);/);
  assert.match(chooseFn, /if \(targetReveal && revealRef\.current === targetReveal\) setAvatarError\(shopErrorMessage\(error\)\);/);
  assert.match(chooseFn, /else setNotice\(\{ tone: 'error', text: shopErrorMessage\(error\) \}\);/);
  assert.match(screen, /onSetAvatar=\{\(\) => \{ if \(reveal\) void chooseAvatar\(reveal\.item\.id, reveal\); \}\}/);
  assert.match(screen, /avatarError=\{avatarError\}/);
  assert.match(screen, /onClose=\{\(\) => \{ setMachineOpen\(false\); setReveal\(undefined\); setAvatarError\(undefined\); onGachaClose\?\.\(\); \}\}/);
  assert.match(machine, /avatarError\?: string;/);
  assert.match(machine, /\{avatarError \? <Text accessibilityLiveRegion="polite"/);
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
  assert.match(skyFn, /onContentSizeChange=\{retryScroll \? onSkyContentSizeChange : undefined\}/);
});

test('PR #320 리뷰(도감에서 같은 수정을 상점에도 포팅): 재스크롤은 내용 높이가 실제로 늘었을 때만 일어난다 — 오류를 다시 읽으려 위로 스크롤한 사용자를 끌어내리지 않는다', () => {
  assert.match(screen, /const skyContentHeight = useRef\(0\);/);
  // JSX 안 인라인 화살표로 ref를 읽으면 react-hooks/refs가 "prop으로 바로 넘긴 함수 리터럴 안의 ref 읽기"를
  // 렌더 중 접근 가능성으로 보고 lint를 막는다(도감 PR #320 리뷰에서 실제로 겪은 lint 실패) — useCallback으로 뺀다.
  const callbackFn = screen.slice(screen.indexOf('const onSkyContentSizeChange ='), screen.indexOf('const quietRefresh ='));
  assert.match(callbackFn, /useCallback\(\(_width: number, height: number\) => \{/);
  // 가드가 먼저 — 늘지 않았으면 쥐고 있던 높이도 안 바꾸고 스크롤도 안 한다(재시도 재렌더가 같은 높이로
  // 다시 불러도 no-op).
  assert.match(callbackFn, /if \(height <= skyContentHeight\.current\) return;/);
  assert.match(callbackFn, /skyContentHeight\.current = height;/);
  assert.ok(
    callbackFn.indexOf('if (height <= skyContentHeight.current) return;') < callbackFn.indexOf('requestAnimationFrame'),
    '가드는 스크롤을 예약하기 전에 와야 한다',
  );
});

test('PR #312 QA: 뽑기 기계는 SkyBackdrop 안, SkyScrollView의 형제로 둔다(RefreshControl 중복 없이)', () => {
  const skyFn = screen.slice(screen.indexOf('const sky = (body'), screen.indexOf('if (!shop.snapshot)'));
  assert.match(skyFn, /<SkyBackdrop>\s*<SkyScrollView/);
  assert.match(skyFn, /<\/SkyScrollView>\s*\{extra\}\s*<\/SkyBackdrop>/, 'extra(모달)는 SkyScrollView 다음, 여전히 SkyBackdrop 안에 있다');
  assert.match(screen, /return sky\(\s*<>/, '성공 화면은 sky()의 두 번째 인자로 뽑기 기계를 넘긴다(머리글·RefreshControl 중복 없음)');
  assert.match(screen, /const machine = !\(gachaOnly \? gachaVisible : machineOpen\) \? null : legacyMachine \? <GachaMachine[\s\S]*?\/> : selectedPool \? <GradeDrawMachine/);
  assert.match(screen, /\n\s*machine,\s*\);/);
  // RefreshControl 배선은 sky() 안에 한 번만 있다 — 되돌리면 중복돼 ui/components.test.ts의 전체 개수 시험이 깨진다.
  assert.equal((screen.match(/<RefreshControl/g) ?? []).length, 1);
});

test('PR #312 리뷰 6번: 구매 성공과 당겨서 새로고침 둘 다 사용 내역의 첫 페이지를 다시 불러오게 한다', () => {
  const refreshFn = screen.slice(screen.indexOf('async function refresh()'), screen.indexOf('async function buy('));
  assert.match(refreshFn, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  const buySuccessStart = screen.indexOf('const result = await api.reroll');
  const buySuccess = screen.slice(buySuccessStart, screen.indexOf('} catch (error) {', buySuccessStart));
  assert.match(buySuccess, /setHistoryRefreshToken\(\(value\) => value \+ 1\);/);
  assert.match(screen, /<HistorySection api=\{api\} refreshToken=\{historyRefreshToken\} \/>/);
});

test('#333: 서버가 시연 보너스를 보낸 때만 잔액 아래에 "시연 체험 마일리지 포함" 작은 문구를 보인다 — 계산은 서버 balance 그대로', () => {
  const rules = readFileSync(fileURLToPath(new URL('../../shop/shop-rules.ts', import.meta.url)), 'utf8');
  assert.match(rules, /export function showcaseBonusLabel\(bonus: number \| undefined\): string \| null/);
  assert.match(rules, /'시연 체험 마일리지 포함'/);
  const card = screen.slice(screen.indexOf('<View style={styles.mileageRow}>'), screen.indexOf('<HistorySection'));
  assert.match(screen, /const bonusLabel = showcaseBonusLabel\(snapshot\.mileage\.showcaseBonus\);/);
  assert.match(card, /\{bonusLabel \? <Text style=\{styles\.rulesText\}>\{bonusLabel\}<\/Text> : null\}/);
  // 화면은 잔액을 다시 계산하지 않는다: 표시도 구매 가능 판정도 snapshot.mileage.balance 하나만 쓴다.
  assert.doesNotMatch(card, /showcaseBonus\s*[-+]|[-+]\s*snapshot\.mileage\.showcaseBonus/);
});


test('shop recovery is scoped by stable account/API/app variant and does not depend on per-render shop objects or busy state', () => {
  assert.match(screen, /accountId: string;/);
  assert.match(screen, /pendingPurchaseScope\(\{ accountId, apiUrl, appVariant: getAppPackageId\(\) \?\? 'app' \}\)/);
  const recoveryEffect = screen.slice(screen.indexOf('const lease = enterShopPurchaseScope(pendingScope)'), screen.indexOf('async function refresh()'));
  assert.match(recoveryEffect, /scope: pendingScope/);
  assert.match(recoveryEffect, /reroll: \(input\) => apiRef\.current\.reroll\(input\)/);
  assert.doesNotMatch(recoveryEffect, /findGrade|rerollButtonState|gachaAffordability/);
  assert.match(recoveryEffect, /\.finally\(\(\) => \{ leaveShopPurchaseScope\(lease\); \}\)/);
  assert.match(recoveryEffect, /subscribeShopPurchaseScope\(pendingScope/);
  assert.match(recoveryEffect, /return \(\) => \{ mounted = false; recoveryGeneration\.current \+= 1; \};/);
  assert.doesNotMatch(recoveryEffect, /busyGrade|shop,|reveal,|return \(\) =>[\s\S]*leaveShopPurchaseScope/);
  const buyFn = screen.slice(screen.indexOf('async function buy('), screen.indexOf('async function chooseAvatar('));
  assert.match(buyFn, /const lease = enterShopPurchaseScope\(pendingScope\)/);
  assert.match(buyFn, /try \{[\s\S]*const storedAttempt = await readPendingPurchase\(pendingScope\)/);
  assert.match(buyFn, /if \(!storedAttempt\) await writePendingPurchase\(pendingScope/);
  assert.match(buyFn, /finally \{[\s\S]*leaveShopPurchaseScope\(lease\)/);
});


test('failed purchase exposes a recovery action independently of the disabled new-purchase control', () => {
  assert.match(screen, /onRecoverPending=\{pending \? requestRecovery : undefined\}/);
  assert.match(machine, /onRecoverPending && displayPhase === 'detail' \? <Control[^>]*disabled=\{busy \|\| refreshing\}[^>]*onPress=\{onRecoverPending\}/);
  const definition = screen.match(/const requestRecovery = useCallback\((\(\) => \{[^}]*\}), \[\]\);/)?.[1];
  assert.ok(definition);
  const recoveryStarted = { current: true };
  let wake = 7;
  const retry = new Function('recoveryStarted', 'setRecoveryWake', `return (${definition});`)(
    recoveryStarted, (update: (value: number) => number) => { wake = update(wake); },
  ) as () => void;
  retry();
  assert.equal(recoveryStarted.current, false, 'the old one-shot mount latch must reopen');
  assert.equal(wake, 8, 'the mounted recovery effect is scheduled without a new purchase');
});

test('등급 뽑기는 동의 필요 오류에서 다시 불러오기 대신 동의 확인 단추를 보인다', () => {
  const gradeMachine = readFileSync(fileURLToPath(new URL('./grade-draw-machine.tsx', import.meta.url)), 'utf8');
  assert.match(screen, /const recheckConsent = useConsentRecheck\(\);/);
  assert.match(screen, /onRecheckConsent=\{recheckConsent\}/);
  assert.equal(screen.match(/drawError === consentRequiredMessage \? \{ label: consentRecheckLabel, onPress: recheckConsent \}/g)?.length, 2);
  assert.match(gradeMachine, /error === consentRequiredMessage && onRecheckConsent\s*\? <Control label=\{consentRecheckLabel\}[^>]*onPress=\{onRecheckConsent\}/);
});
