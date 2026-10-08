import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

function between(start: string, end: string): string {
  const from = screen.indexOf(start);
  const to = screen.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return screen.slice(from, to);
}

test('the code check is gated by createIdentityRequestGate (#265)', () => {
  assert.match(screen, /const inspectGate = useRef\(createIdentityRequestGate\(\)\)\.current;/);
});

test('changing the input cancels a code check still in flight', () => {
  const changeToken = between('function changeToken', 'async function startScan');
  assert.match(changeToken, /inspectGate\.cancel\(\);/);
});

test('a code check result reaches the preview only through the current-request check', () => {
  const inspect = between('async function inspect', 'async function redeem');
  assert.match(inspect, /const request = inspectGate\.start\(\);/);
  assert.match(inspect, /const accepted = acceptInspection\(inspectGate\.isCurrent\(request\), code, next\);\s*if \(!accepted\) return;/);
  assert.match(inspect, /setPreview\(accepted\.preview\);/);
  assert.match(inspect, /setPendingRedeemToken\(accepted\.pendingRedeemToken\);/);
  // The raw response never goes to state directly, and a stale failure shows no message.
  assert.doesNotMatch(inspect, /setPreview\(next\)|setPendingRedeemToken\(code\)/);
  assert.match(inspect, /if \(inspectGate\.isCurrent\(request\)\) \{\s*playUiSound\('error'\);\s*setMessage\(messageFor\(error\)\);\s*\}/);
  // The busy flag is always released, so a dropped answer never leaves the buttons disabled.
  assert.match(inspect, /finally \{[^}]*setBusy\(false\);/);
});

test('confirming redeems only the code checked for the current input', () => {
  const redeem = between('async function redeem', 'async function celebrate');
  assert.match(redeem, /const target = redeemTarget\(token, pendingRedeemToken, preview\);/);
  assert.match(redeem, /await api\.redeemClaim\(target\)/);
  assert.doesNotMatch(redeem, /redeemClaim\(pendingRedeemToken\)/);
});

test('받은 수집품 열기는 외형이 붙은 보상 전체를 모아 실제 카드가 보일 때까지 재시도 가능하다', () => {
  // 방문 수령 응답에는 외형 정보가 없어 도감을 읽어 확인하고, 외형이 붙은 보상만 목표(targetVisitCount) 오름차순으로 모은다.
  const find = between('async function findGrantedArtwork', 'async function celebrate');
  assert.match(find, /await api\.getCollection\(\)/);
  assert.match(find, /\.sort\(\(a, b\) => a\.targetVisitCount - b\.targetVisitCount\)/);
  assert.match(find, /setArtworkReward\(\{ claimSlotId: result\.claimSlotId, entitlementIds,[\s\S]*?artworkRewards:/);
  // 조회 실패는 버튼만 숨긴다.
  assert.match(find, /catch \{[^}]*\}/);
  assert.doesNotMatch(screen, /grantedRewards\[0\]/);
  assert.match(screen, /currentArtworkReward\.entitlementIds\.some\(\(id\) => !presentedIds\.has\(id\)\)/);
  assert.match(screen, /entitlement: currentArtworkReward\.entitlementIds\.join\(','\)/);
  assert.doesNotMatch(screen, /setOpenedCollectibleClaimSlot/);
  // 새 수령·코드 변경 때 이전 버튼 대상이 남지 않는다.
  assert.match(between('function changeToken', 'async function startScan'), /setArtworkReward\(undefined\);/);
  assert.match(between('async function redeem', 'async function findGrantedArtwork'), /setArtworkReward\(undefined\);\s*void findGrantedArtwork\(result\);/);
});

test('#295 테스트 방문 만들기는 시연·개발 빌드에만 보이고 운영 패키지는 섹션 자체가 없다', () => {
  assert.match(screen, /canShowTestVisitSection\(getAppPackageId\(\)\)/);
  assert.match(screen, /\{showTestVisitSection \? \(/);
});

test('#295 테스트 방문 만들기 성공은 일반 방문 수령과 같은 길(setRedeemed·findGrantedArtwork·celebrate)을 탄다', () => {
  const createTestVisit = between('async function createTestVisit', 'async function findGrantedArtwork');
  assert.match(createTestVisit, /await api\.createTestVisit\(selectedTestVisitMerchantId\)/);
  assert.match(createTestVisit, /setRedeemed\(result\);/);
  assert.match(createTestVisit, /void findGrantedArtwork\(result\);/);
  assert.match(createTestVisit, /void celebrate\(result, before\);/);
  assert.match(createTestVisit, /setTestVisitMessage\(messageFor\(error\)\);/);
  // 버튼이 항상 다시 풀린다(응답이 버려져도 "만드는 중…"에 멈추지 않는다).
  assert.match(createTestVisit, /finally \{[^}]*setTestVisitBusy\(false\);/);
});

test('#295 테스트 방문 만들기는 가상 점포만 /merchants에서 걸러 고른다', () => {
  assert.match(screen, /createMerchantApiClient\(apiUrl\)\.listMerchants\(\)/);
  assert.match(screen, /merchants\.filter\(\(merchant\) => merchant\.demo\)/);
});

test('방문 인증 헤더는 성공 전에도 숨은 탭에서 홈으로 나갈 수 있다', () => {
  const header = between('header={', 'contentContainerStyle=');
  assert.match(header, /<AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요">/);
  assert.match(header, /accessibilityLabel="홈으로"/);
  assert.match(header, /onPress=\{\(\) => router\.replace\('\/'\)\}/);
  assert.match(header, />홈으로</);
});

test('Android 뒤로가기도 숨은 방문 인증 탭에서 홈으로 돌아간다', () => {
  assert.match(screen, /import \{ BackHandler, Platform, Pressable,/);
  assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress', \(\) => \{\s*router\.replace\('\/'\);\s*return true;\s*\}\)/);
});

test('방문 완료 카드는 QR 방문과 테스트 방문 모두 홈으로 돌아갈 수 있다', () => {
  const card = between('{redeemed ? (', '</SkyScrollView>');
  assert.match(card, /accessibilityLabel="홈으로"/);
  assert.match(card, /onPress=\{\(\) => router\.replace\('\/'\)\}/);
  assert.match(card, />홈으로</);
});

test('cold restore and pending cleanup use the redemption gate and exact token, including expired replay', async () => {
  const { createIdentityRequestGate } = await import('../../commerce/customer-identity');
  const gate = createIdentityRequestGate();
  const oldRestore = gate.start();
  let finish!: (value: string) => void;
  const deferred = new Promise<string>((resolve) => { finish = resolve; });
  let applied = false;
  const attempt = deferred.then(() => { if (gate.isCurrent(oldRestore)) applied = true; });
  gate.cancel(); // a new scan or input edit wins
  finish('old-claim');
  await attempt;
  assert.equal(applied, false);
  const restore = between('useEffect(() => {\n    if (!securePending) return;', 'useFocusEffect(useCallback');
  assert.match(restore, /const restoreRequest = redeemGate.start\(\)/);
  assert.match(restore, /saved.state === 'expired'[\s\S]*?api.redeemClaim\(pending.token\)/);
  assert.match(restore, /if \(!isCurrent\(\)\) return;[\s\S]*?setRedeemed\(result\)/);
  assert.match(restore, /pendingStore.clearIfMatches\(accountId, pending\)/);
  assert.doesNotMatch(restore, /pendingStore.clear\(accountId\)/);
});

test('late redemption A cannot clear a newer B pending token for the same account', () => {
  const redeem = between('async function redeem', 'async function createTestVisit');
  assert.match(redeem, /pendingStore.save\(pending\)/);
  assert.match(redeem, /if \(!redeemGate.isCurrent\(request\)\) \{ if \(securePending\) await pendingStore.clearIfMatches\(accountId, pending\); return; \}/);
  assert.match(redeem, /const result = await api.redeemClaim\(target\);\s*if \(!redeemGate.isCurrent\(request\)\) return;\s*if \(securePending\) void pendingStore.clearIfMatches\(accountId, pending\)/);
  assert.doesNotMatch(redeem, /pendingStore.clear\(accountId\)/);
});

test('#412 시연 1인 2역: 점주 화면이 넘긴 방문 코드는 열릴 때 한 번만 받아 코드 입력·상태 확인까지만 한다', () => {
  assert.match(screen, /const demoHandoff = canUseDemoHandoff\(getAppPackageId\(\)\);/);
  const consume = between('const demoHandoff = canUseDemoHandoff', '// 축하 화면이 열린 방문을 기억해');
  // 값은 넘긴 계정만 받고, 보관된 수령 복구를 다 읽은 뒤에만 입력칸을 바꾼다. 복구할 것이 있으면 넘어온 값은 버린다.
  assert.match(consume, /if \(!demoHandoff \|\| restore === 'reading'\) return;\s*const handedOver = takeDemoHandoff\('claim', accountId\);\s*if \(!handedOver \|\| restore === 'found'\) return;\s*changeToken\(handedOver\);\s*void inspect\(handedOver\);/);
  assert.match(consume, /\}, \[restore\]\);/);
  // 확정은 사용자가 "방문 수령 확정"을 눌러야 한다: 넘김 경로가 redeem을 부르지 않는다.
  assert.doesNotMatch(consume, /redeem\(|redeemClaim/);
});

test('#412 시연 1인 2역: 식별 QR 카드의 역방향 시작은 살아 있는 QR만 점주 화면에 넘기고 시연 빌드에서만 보인다', () => {
  const handoff = between('function handoffToMerchant', 'function changeToken');
  assert.match(handoff, /if \(!demoHandoff \|\| !identity \|\| isCustomerIdentityExpired\(identity\.expiresAt\)\) return;/);
  assert.match(handoff, /setDemoHandoff\(\{ kind: 'identity', accountId, token: identity\.token, expiresAt: identity\.expiresAt \}\);\s*queueMerchantNotificationRole\(accountId\);/);
  assert.match(screen, /\{demoHandoff && identity && !isCustomerIdentityExpired\(identity\.expiresAt, now\) \? <Pressable[\s\S]*?시연: 점주 화면에서 이 QR 확인해 보기/);
});

test('#412 the demo handoff never cancels the secure pending restore: it waits for the read and yields to a pending item', () => {
  assert.match(screen, /const \[restore, setRestore\] = useState<'reading' \| 'none' \| 'found'>\(securePending \? 'reading' : 'none'\);/);
  const restore = between("void pendingStore.loadState(accountId, selectedMerchantId)", '}, [accountId, selectedMerchantId, api, pendingStore, securePending, redeemGate]);');
  assert.match(restore, /if \(current\) setRestore\(saved\.state === 'none' \? 'none' : 'found'\);\s*if \(!isCurrent\(\) \|\| saved\.state === 'none'\) return;/);
  assert.match(restore, /\.catch\(\(\) => \{\s*if \(current\) setRestore\('none'\);/);
  // changeToken (which the handoff calls) is what cancels the restore's request generation.
  assert.match(between('function changeToken', 'async function startScan'), /redeemGate\.cancel\(\);/);
});
