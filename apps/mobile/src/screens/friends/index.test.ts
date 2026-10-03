import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const screen = read('./index.tsx');
const passport = read('./passport.tsx');
const tabRoute = read('../../app/(tabs)/friends.tsx');
const passportRoute = read('../../app/friends/[friendshipId].tsx');

test('#298: 친구 is a hidden tab reached from the home header / 내 정보, with a BackHeader (home fallback) instead of the tab AppHeader', () => {
  assert.match(screen, /export const FRIENDS_TITLE = '친구'/);
  assert.doesNotMatch(screen, /AppHeader/, '친구 no longer builds its own tab header');
  // The route builds the header (same split as settings.tsx/account-settings) and hands it down, so every state — signed-out,
  // demo-not-configured, loaded — keeps a way back even though 친구 is no longer in the bottom bar.
  assert.match(tabRoute, /<BackHeader title=\{FRIENDS_TITLE\}>/);
  assert.match(tabRoute, /<Mascot interactive pose="friends" size=\{heroMascotSize\(fontScale, 112\)\} \/>/);
  assert.match(tabRoute, /<SkyBackdrop><AuthRequiredRoute header=\{header\} \/><\/SkyBackdrop>/);
  assert.match(tabRoute, /key=\{auth\.accountId\}/);
  assert.match(tabRoute, /header=\{header\}/);
  assert.match(screen, /header: ReactNode/);
  assert.match(screen, /useTabBarClearance\(\)/);
  assert.match(screen, /progressViewOffset=\{insets\.top\}/);
});

test('#298: the layout hides the 친구 tab slot but keeps the route, and offers two other ways in', () => {
  const layout = read('../../app/(tabs)/_layout.tsx');
  assert.match(layout, /name="friends" options=\{\{ title: '친구', href: null \}\}/);
  const appHeader = read('../../ui/app-header.tsx');
  assert.match(appHeader, /showFriendsEntry/);
  assert.match(appHeader, /href="\/friends"/);
  const settingsScreen = read('../account-settings/index.tsx');
  assert.match(settingsScreen, /href="\/friends"/);
});

test('#298: BackHeader defaults to the home fallback when there is no back history (cold deep link, post-login continuation)', () => {
  const backHeader = read('../../ui/back-header.tsx');
  // Issue #305(효과음)가 onPress에 playUiSound('close')를 더하며 삼항 표현식 대신 블록 본문으로 바뀌었다 — 동작은
  // 그대로: onBack이 있으면 그걸 쓰고, 없으면 뒤로 기록이 있을 때만 뒤로, 없으면 홈으로 보낸다.
  assert.match(backHeader, /if \(onBack\) onBack\(\);\s*else if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\('\/'\);/);
  // open.tsx still lands a cold link (or one resumed after sign-in) on /friends; BackHeader's default onBack is what makes
  // "뒤로" fall back home from there instead of leaving the person stuck or bouncing to a screen they never visited.
  const openRoute = read('../../app/open.tsx');
  assert.match(openRoute, /router\.replace\('\/friends'\)/);
  assert.match(openRoute, /rememberPendingFriendCode\(target\.code\)/);
});

test('#298: returning from a friend passport lands back on 친구, where the floating tab bar reappears (settings already proved this pattern)', () => {
  // The friends screen's own ranking rows push /friends/[friendshipId] (a plain stack route, not a tab); coming back is a
  // plain router.back(), which refocuses the hidden 친구 route. floating-tab-bar.tsx already hides the bar away from any
  // route not in its visible list and shows it again once the focused route is visible — the same mechanism 내 정보 relies on.
  const bar = read('../../navigation/floating-tab-bar.tsx');
  assert.match(bar, /away = keyboardShown \|\| !visible\.some\(\(route\) => route\.key === focusedKey\)/);
  assert.match(screen, /router\.push\(\{ pathname: '\/friends\/\[friendshipId\]'/);
});

test('my card shows the nickname, the big code, a QR of the fragment link, a system share and a confirmed code change', () => {
  assert.match(screen, /accessibilityLabel="별명 바꾸기"/);
  assert.match(screen, /formatFriendCode\(me\.code\)/);
  assert.match(screen, /friendCodeAccessibilityLabel\(me\.code\)/);
  assert.match(screen, /<ClaimQr\s+code=\{friendLink\(me\.code, variant\)\}/);
  assert.match(screen, /Share\.share\(\{ message: friendShareMessage\(code, variant\) \}\)/);
  assert.match(screen, /label="코드 공유"/);
  assert.match(screen, /label=\{rotating \? '바꾸는 중…' : '코드 바꾸기'\}/);
  assert.match(screen, /const ROTATE_CONFIRM = '새 코드를 만들면 예전 코드로는 더 이상 추가할 수 없어요\. 지금 친구는 그대로예요\.'/);
  assert.match(screen, /Alert\.alert\('코드 바꾸기', ROTATE_CONFIRM/);
  // The QR and share text follow the installed package: the showcase app shares no https link (its host does not exist yet).
  assert.match(screen, /linkVariantFor\(getAppPackageId\(\)\)/);
});

test('adding takes a typed code in upper case or a scanned QR, and a QR or link is confirmed before it adds', () => {
  assert.match(screen, /onChangeText=\{\(text\) => \{ setCodeInput\(text\.toUpperCase\(\)\)/);
  assert.match(screen, /autoCapitalize="characters"/);
  assert.match(screen, /accessibilityLabel="친구 코드"/);
  assert.match(screen, /import \{ CameraView, useCameraPermissions \} from 'expo-camera'/);
  assert.match(screen, /barcodeScannerSettings=\{\{ barcodeTypes: \['qr'\] \}\}/);
  assert.match(screen, /createScanGate\(\)/);
  assert.match(screen, /parseScannedFriendCode\(raw, variant\)/);
  assert.match(screen, /Alert\.alert\(\s*'이 코드로 친구를 추가할까요\?'/);
  assert.match(screen, /consumePendingFriendCode\(\)/);
  // Every failure is said in Korean through one mapper; the raw code never reaches the screen.
  assert.match(screen, /friendsErrorMessage\(error\)/);
  assert.match(screen, /friendCodeProblemMessage\(checked\.reason\)/);
  assert.match(screen, /카메라 권한이 없어/);
});

test('the ranking says once what friends can see and up to which day, and each friend row opens that friend', () => {
  assert.match(screen, /친구 순위/);
  assert.match(screen, /rankingNote\(me\.asOf\)/);
  assert.match(screen, /buildRankingRows\(snapshot\)/);
  assert.match(screen, /<TierDots medals=\{row\.medals\} \/>/);
  assert.match(screen, /배지 \{row\.badges\.earned\}\/\{row\.badges\.total\}/);
  assert.match(screen, /router\.push\(\{ pathname: '\/friends\/\[friendshipId\]'/);
  assert.match(screen, /accessibilityLabel=\{rowAccessibilityLabel\(row\)\}/);
  assert.match(screen, /<StateScene kind="empty" title="아직 친구가 없어요"/);
  assert.match(screen, /<StateScene kind="loading"/);
  assert.match(screen, /kind="error"/);
  // Nothing in the list draws a date or a visit count.
  assert.doesNotMatch(screen, /visitedAt|businessDate|방문 \{/);
});

test('the friend passport is read only: medals, badges, stamp names, and a confirmed end of the friendship', () => {
  assert.match(passport, /<BackHeader title="친구 여권" \/>/);
  // The block is kept per account, so the copy says "이 계정으로", not "예전 코드로".
  assert.match(passport, /export const REMOVE_CONFIRM = '끊으면 서로의 여권이 사라지고, 이 친구는 이 계정으로 나를 다시 추가할 수 없어요\.'/);
  assert.doesNotMatch(passport, /예전 코드로/);
  assert.match(passport, /Alert\.alert\(`\$\{target\.nickname\} 님과 친구를 끊을까요\?`, REMOVE_CONFIRM/);
  assert.match(passport, /\{ text: '친구 끊기', style: 'destructive'/);
  assert.match(passport, /<Medallion[\s\S]*?progress=\{null\}/);
  assert.match(passport, /passportAsOfNote\(snapshot\.me\.asOf\)/);
  assert.match(passport, /visitedShopSummary\(friend\.stamps\.length\)/);
  assert.match(passport, /accessibilityLabel=\{`\$\{name\} 도장 받음`\}/);
  assert.match(passport, /caught\.code === 'FRIEND_NOT_FOUND'/);
  // 공개 목록에서 이름이 유일한 도장만 가게 상세로 이어진다. 친구의 방문 날짜·횟수는 여전히 받지 않는다.
  assert.match(passport, /friendStampMerchantId\(name, merchants\)/);
  assert.match(passport, /accessibilityRole="link" accessibilityLabel=\{`\$\{name\} 도장 받음, 가게 보기`\}/);
  assert.match(passport, /params: \{ merchantId, from: 'friend' \}/);
  assert.doesNotMatch(passport, /businessDate|visitedAt/);
  assert.match(passportRoute, /<BackHeader title="친구 여권" \/>/);
  assert.match(passportRoute, /<SkyBackdrop><AuthRequiredRoute header=\{header\} \/><\/SkyBackdrop>/);
});

test('the two friends screens never put a friend code or nickname into a URL or a log', () => {
  for (const source of [screen, passport, tabRoute, passportRoute]) {
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/);
    assert.doesNotMatch(source, /\?friend=|`[^`]*\/me\/friends[^`]*\$\{/);
  }
});

test('after unfriending, one more prompt offers a new code, since the block does not follow a friend who signs in with another account', () => {
  assert.match(passport, /export const ROTATE_AFTER_REMOVE_TITLE = '내 친구 코드도 바꿀까요\?'/);
  assert.match(passport, /export const ROTATE_AFTER_REMOVE_BODY = '코드를 바꾸면 끊은 친구가 다른 계정으로도 지금 코드를 쓸 수 없어요\. 다른 친구는 그대로예요\.'/);
  assert.match(passport, /\{ text: '그대로 두기', style: 'cancel', onPress: finish \}/);
  assert.match(passport, /\{ text: '코드 바꾸기', onPress: \(\) => void rotateThenLeave\(\) \}/);
  // The prompt follows a successful unfriend and an already-gone friendship alike, and calls the existing rotate API.
  assert.match(passport, /await api\.removeFriend\(friendshipId\);\s*offerNewCode\(\);/);
  assert.match(passport, /caught\.code === 'FRIEND_NOT_FOUND'\) \{\s*offerNewCode\(\);/);
  assert.match(passport, /await api\.rotateCode\(\);\s*finish\(\);/);
  // Every way out (either button, or dismissing the prompt) goes back to the list, and only once.
  assert.match(passport, /onDismiss: finish/);
  // The once-only guard lives on the screen (a ref), not inside one prompt, and closes when the screen is unmounted or hidden.
  assert.match(passport, /const leaveGuard = useRef<LeaveOnce \| undefined>\(undefined\);/);
  assert.match(passport, /const guard = createLeaveOnce\(\(\) => \(router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/friends'\)\)\);\s*leaveGuard\.current = guard;\s*return \(\) => guard\.dispose\(\);/);
  assert.match(passport, /useFocusEffect\(useCallback\(\(\) => \{\s*const guard = createLeaveOnce/);
  assert.match(passport, /const finish = \(\) => leaveGuard\.current\?\.run\(\);/);
  assert.doesNotMatch(passport, /let left = false|left = true/);
});

test('a rotate reply the app cannot read is not called a failure: the prompt points to the friends tab', () => {
  assert.match(passport, /rotateFailureCopy,/);
  assert.match(passport, /const \{ title, body \} = rotateFailureCopy\(caught\);\s*Alert\.alert\(title, body, \[/);
  assert.doesNotMatch(passport, /'코드를 바꾸지 못했어요'/, 'the wording lives in rotateFailureCopy, which tells a refusal from an unreadable reply');
});

test('the friend passport stays busy from the confirmed unfriend to the end of the flow, so nothing can start it twice', () => {
  const remove = passport.slice(passport.indexOf('async function remove()'), passport.indexOf('// Asked once the friendship is gone'));
  // The busy state is released only where nothing was removed; a success or an already-gone friendship leaves it set.
  assert.equal((remove.match(/removingNow\.current = false;/g) ?? []).length, 1);
  assert.equal((remove.match(/setRemoving\(false\);/g) ?? []).length, 1);
  assert.doesNotMatch(remove, /finally/);
  assert.match(remove, /setError\(friendsErrorMessage\(caught\)\);\s*removingNow\.current = false;\s*setRemoving\(false\);/);
  assert.match(passport, /disabled=\{removing\}/);
  // While the new code is made the button says so, then goes back to the list.
  assert.match(passport, /const \[rotatingCode, setRotatingCode\] = useState\(false\);/);
  assert.match(passport, /setRotatingCode\(true\);\s*try \{\s*await api\.rotateCode\(\);/);
  assert.match(passport, /\{rotatingCode \? '코드 바꾸는 중…' : removing \? '끊는 중…' : '친구 끊기'\}/);
});

test('my own code arriving by QR or link is only said to be mine: no prompt, no request', () => {
  assert.match(screen, /const OWN_CODE_NOTICE = '내 친구 코드예요\.'/);
  assert.match(screen, /const confirmAdd = useCallback\(\(code: string\) => \{\s*if \(code === myCodeRef\.current\) \{\s*setCodeInput\(''\);\s*setAddNotice\(\{ tone: 'error', text: OWN_CODE_NOTICE \}\);\s*return;\s*\}/);
  const own = screen.indexOf('OWN_CODE_NOTICE }');
  assert.ok(own > 0 && own < screen.indexOf("'이 코드로 친구를 추가할까요?'"), 'checked before the confirm dialog');
});

test('a code from a link waits for my snapshot before it is judged, so my own code is never asked about', () => {
  // The tab a link opens is freshly mounted and has no code of mine yet: the pending code goes through the holder, not straight to the dialog.
  assert.match(screen, /import \{ createHeldFriendCode \} from '@\/friends\/held-friend-code'/);
  assert.match(screen, /const \[heldCode\] = useState\(createHeldFriendCode\);/);
  assert.match(screen, /const ready = heldCode\.arrive\(code, statusRef\.current\);\s*if \(ready !== undefined\) confirmAdd\(ready\);/);
  assert.match(screen, /if \(pending\) receiveLinkCode\(pending\);/);
  assert.doesNotMatch(screen, /if \(pending\) confirmAdd\(pending\)/);
  // Once the load has ended (ready or failed) the waiting code is judged, after my code is stored for that comparison.
  assert.match(screen, /statusRef\.current = friends\.status;\s*const waiting = heldCode\.settle\(friends\.status\);\s*if \(waiting !== undefined\) confirmAdd\(waiting\);/);
  assert.ok(
    screen.indexOf('myCodeRef.current = myCode;') < screen.indexOf('heldCode.settle(friends.status)'),
    'my code is stored before a waiting code is judged',
  );
  // Leaving the tab forgets a waiting code; a scanned QR (snapshot already loaded) still goes straight to confirmAdd.
  assert.match(screen, /useFocusEffect\(useCallback\(\(\) => \(\) => heldCode\.clear\(\), \[heldCode\]\)\);/);
  assert.match(screen, /setScanning\(false\);\s*confirmAdd\(scanned\.code\);/);
});

test('a code put in the box only for the question leaves it when the question is turned down or dismissed', () => {
  assert.match(screen, /const clearCode = \(\) => setCodeInput\(\(current\) => \(current === code \? '' : current\)\);/);
  assert.match(screen, /\{ text: '취소', style: 'cancel', onPress: clearCode \}/);
  assert.match(screen, /\{ cancelable: true, onDismiss: clearCode \}/);
  // Adding is not affected: the code stays until the add has an answer.
  assert.match(screen, /\{ text: '추가', onPress: \(\) => void addFriend\(code\) \}/);
});

test('a friend QR of another MassCOM build is said so in the same line as a link, and nothing is sent', () => {
  assert.match(screen, /scanned\.reason === 'OTHER_APP' \? friendLinkProblemMessage\('OTHER_APP'\) : NOT_A_FRIEND_QR/);
  const handler = screen.slice(screen.indexOf('function handleScanned'), screen.indexOf('async function saveNickname'));
  assert.doesNotMatch(handler, /api\.addFriend|addFriend\(/);
});

test('the guards against a double tap read refs, not React state that only updates on the next render', () => {
  assert.match(screen, /const addingNow = useRef\(false\);\s*const rotatingNow = useRef\(false\);\s*const nicknameBusyNow = useRef\(false\);/);
  assert.match(screen, /if \(rotatingNow\.current\) return;\s*rotatingNow\.current = true;\s*setRotating\(true\);/);
  assert.match(screen, /rotatingNow\.current = false;\s*setRotating\(false\);/);
  assert.match(screen, /if \(nicknameBusyNow\.current\) return;/);
  assert.match(screen, /nicknameBusyNow\.current = true;\s*setNicknameBusy\(true\);/);
  assert.match(screen, /nicknameBusyNow\.current = false;\s*setNicknameBusy\(false\);/);
  assert.doesNotMatch(screen, /if \(rotating\) return;|if \(nicknameBusy\) return;/);
});

test('a code or nickname reply the app cannot read reloads the screen, so no stale code or QR stays on it', () => {
  assert.match(screen, /if \(replyNeedsRefresh\(error\)\) void refreshQuietly\(\);/);
  assert.equal((screen.match(/replyNeedsRefresh\(error\)/g) ?? []).length, 2, 'nickname and rotate');
});

test('the camera permission text names the friend code QR next to the visit claim QR, and still promises nothing is stored', () => {
  const config = JSON.parse(read('../../../app.json')) as { expo: { plugins: unknown[] } };
  const camera = config.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera') as [string, { cameraPermission: string }];
  assert.ok(camera, 'the expo-camera plugin is configured');
  const text = camera[1].cameraPermission;
  assert.match(text, /방문 수령 QR/);
  assert.match(text, /친구 코드 QR/);
  assert.match(text, /읽는 데만 카메라를 사용합니다/);
  assert.match(text, /사진이나 영상은 저장하지 않습니다/);
});
