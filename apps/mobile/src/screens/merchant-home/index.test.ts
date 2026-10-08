import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('./index.tsx');
const status = read('./status.tsx');
const staff = read('../merchant-claim/staff.tsx');
const showcase = read('../showcase-merchant/index.tsx');
const steps = read('./visit-step.ts');

test('시연 권한 승인 분기에만 점주 셸을 연결하고 세 탭은 분리한다', () => {
  assert.match(showcase, /if \(state.status === 'allowed' && apiUrl\) \{\s+return <MerchantHomeScreen/);
  assert.match(showcase, /role: context.role/);
  assert.match(home, /useState<Tab>\('visit'\)/);
  assert.match(home, /accessibilityRole="tablist"/);
  assert.match(home, /accessibilityRole="tab"/);
  assert.match(home, /accessibilityState=\{\{ selected: tab === item.id \}\}/);
  assert.match(home, /minHeight: 56/);
  assert.match(home, /tab === 'status' \? <MerchantStatusScreen/);
  assert.match(home, /tab === 'decorate' \? <ScrollView/);
  assert.doesNotMatch(staff, /MerchantArtEntryCard|StaffReversalCards/);
  assert.doesNotMatch(read('../../app/_layout.tsx').slice(read('../../app/_layout.tsx').indexOf('return <Stack')), /MerchantHomeScreen/);
});

test('시연 점주 종료와 고객 설정은 실제 역할 선택으로 돌아가고 내부 화면 닫기는 점주 화면에 남는다', () => {
  const root = read('../../app/_layout.tsx');
  const settings = read('../../app/(tabs)/settings.tsx');
  assert.match(root, /onReturnToRole=\{returnToRole\}/);
  assert.match(root, /ShowcaseRoleReturnContext\.Provider value=\{showShowcaseRoleEntry\(getAppPackageId\(\)\) \? returnToRole : undefined\}/);
  assert.match(settings, /useContext\(ShowcaseRoleReturnContext\)/);
  assert.match(settings, /<BackHeader title="내 정보">\{returnToRole \? \(/);
  assert.match(settings, /역할 선택으로/);
  assert.match(showcase, /else onReturnToRole\(\)/);
  assert.match(showcase, /!notificationsOpen && !shouldHandleHardwareBack\(\{ tour, adminOpen, screenStatus: state\.status \}\)/);
  assert.match(showcase, /if \(adminOpen\) setAdminOpen\(false\)/);
  assert.match(showcase, /else if \(artOpen\) setArtOpen\(false\)/);
  assert.match(home, /\{ label: '역할 선택으로', onPress: props\.onReturnToRole \}/);
  assert.match(staff, /onRequestClose=\{done\}/);
});

test('기존 기능 진입점과 전체 화면 발급·복구를 모두 유지한다', () => {
  for (const label of ['역할 선택으로', '빈 공간 투어', '권한 요청 관리', '로그아웃', '방문 확인', '오늘·현황', '가게 꾸미기']) assert.ok(home.includes(label), label);
  for (const handler of ['startScan', 'scanned', 'resolve', 'lookupCoupons', 'confirmRedeem', 'issue', 'reissue', 'recoverCurrent']) assert.match(staff, new RegExp(`function ${handler}\\(`));
  assert.match(staff, /<BottomSheet isPresented=/);
  assert.match(staff, /<RNHostView style=\{\{ width: width - 32, height:[^\n]+\}\}>\s*<ScrollView/);
  assert.match(staff, /`쿠폰 \$\{coupons.length\}장`/);
  assert.match(staff, /presentationStyle="fullScreen"/);
  const modal = staff.slice(staff.indexOf('<Modal'), staff.indexOf('</Modal>'));
  assert.match(modal, /<ClaimQr code=\{issued.token\}/);
  assert.match(modal, /남은 시간/);
  assert.match(modal, /label="다 됐어요"/);
  assert.match(modal, /merchantName/);
  // 안내만 스크롤되고 QR과 완료 버튼은 스크롤 밖에서 공간을 유지한다.
  const guidance = modal.slice(modal.indexOf('<ScrollView'), modal.indexOf('</ScrollView>'));
  assert.match(guidance, /minHeight: 0/);
  assert.match(guidance, /accessibilityLiveRegion="polite"/);
  assert.doesNotMatch(guidance, /<ClaimQr|label="다 됐어요"/);
  assert.match(modal.slice(modal.indexOf('</ScrollView>')), /label="다 됐어요" onPress=\{done\}/);
  assert.match(modal, /minHeight: minimumClaimQrSize \+ 16/);
  assert.match(modal, /onLayout=\{/);
  assert.match(modal, /flexDirection: compact \? 'row' : 'column'/);
  assert.match(staff, /focusMerchantHeading\(heading.current\)/);
  assert.match(read('./focus-heading.ts'), /AccessibilityInfo.setAccessibilityFocus/);
  assert.match(staff, /accessibilityLiveRegion="polite"/);
  assert.match(home, /https:\/\/www.masscom.kr\/merchant\//);
  assert.match(home, /점주 웹은 운영 가게 계정에서 열려요/);
  assert.match(home, /Share.share/);
});

test('쿠폰 자동 조회가 방문 발급을 막지 않고 발급 뒤 늦은 응답은 버린다', () => {
  const resolve = staff.slice(staff.indexOf('async function resolve('), staff.indexOf('function scanned('));
  assert.match(resolve, /void api.lookupCustomerCoupons\(merchantId, nextToken\).then/);
  assert.doesNotMatch(resolve, /await api.lookupCustomerCoupons/);
  assert.match(resolve, /if \(requestGate.isCurrent\(current\)\) setCoupons/);
  const issue = staff.slice(staff.indexOf('async function issue('), staff.indexOf('async function reissue('));
  assert.match(issue, /const current = requestGate.start\(\)/);
  assert.match(issue, /if \(!requestGate.isCurrent\(current\)\) return/);
});

test('현황은 독립 재시도·당겨서 새로 고침을 제공하고 의견 글은 Text로만 그린다', () => {
  assert.match(status, /getOverview\(merchantId\)/);
  assert.match(status, /getVisitorFeedback\(merchantId\)/);
  assert.match(status, /RefreshControl/);
  assert.match(status, /overviewError \? <Retry/);
  assert.match(status, /feedbackError \? <Retry/);
  assert.match(status, /아직 받은 의견이 없어요/);
  assert.match(status, /<Text selectable[^>]*>\{note.text\}<\/Text>/);
  assert.match(status, /<StaffReversalCards/);
  assert.doesNotMatch(home + status + staff, /https?:\/\/[^'"\s]+\.(png|jpg|webp)|dangerouslySetInnerHTML|WebView/);
});

test('#412 점주 체험 단계 카드는 누를 수 없는 "단계 n/4" 안내이고 카메라 안내는 첫 단계에서만 나온다', () => {
  assert.match(steps, /'① 내 체험 가게가 열렸어요', '② 손님이 되어 QR 보여주기', '③ 방문 코드 발급', '④ 오늘·현황에서 확인'/);
  const card = staff.slice(staff.indexOf('단계 {cardStep}/4') - 120, staff.indexOf('<Text ref={heading}'));
  assert.match(card, /단계 \{cardStep\}\/4/);
  assert.match(card, /merchantDemoSteps\.map/);
  assert.doesNotMatch(card, /Pressable|onPress/);
  // 기본 탭은 그대로 방문 확인이다.
  assert.match(home, /useState<Tab>\('visit'\)/);
  // 카메라 안내는 step === 1 카드 안의 폴백이다.
  const first = staff.slice(staff.indexOf('{step === 1 ? <View style={styles.formCard}>'), staff.indexOf('{token && !issued ?'));
  assert.match(first, /canUseCamera \? <>/);
  assert.match(first, /카메라가 필요해 Android 앱에서만/);
});

test('#412 시연 1인 2역: 단추는 시연·개발 빌드(웹 포함)에서만, 모두 실제 API와 기존 확인·발급 단계를 거친다', () => {
  assert.match(staff, /const demoHandoff = canUseDemoHandoff\(getAppPackageId\(\)\);/);
  const start = staff.slice(staff.indexOf('async function startDemoCustomer'), staff.indexOf('function handoffToCustomer'));
  assert.match(start, /if \(busy \|\| !demoHandoff\) return;/);
  assert.match(start, /await api\.createCustomerIdentity\(\)/);
  assert.match(start, /scanned\(customer\.token, true\)/);
  // 발급·수령을 대신 부르지 않는다: 확인·발급은 기존 단추로 이어진다.
  assert.doesNotMatch(start, /issue\(|issueOrReissueIdentityClaim|redeemClaim/);
  assert.match(staff, /\{demoHandoff \? <Button styles=\{styles\} label=\{busy \? '만드는 중…' : '시연: 내 손님 QR로 해 보기'\}/);
  const handoff = staff.slice(staff.indexOf('function handoffToCustomer'), staff.indexOf('return <View style={{ flex: 1 }}>'));
  assert.match(handoff, /if \(!demoHandoff \|\| !ownIdentity \|\| !onBrowseAsCustomer \|\| !issued/);
  assert.match(handoff, /setDemoHandoff\(\{ kind: 'claim', accountId, token: issued\.token, expiresAt: issued\.expiresAt \}\);\s*rememberInternalAuthReturn\('\/claim', merchantId\);\s*onBrowseAsCustomer\(\);/);
  const modal = staff.slice(staff.indexOf('<Modal'), staff.indexOf('</Modal>'));
  assert.match(modal, /demoHandoff && ownIdentity && onBrowseAsCustomer && !issuedUncertain && seconds > 0 \? <Button styles=\{styles\} label="손님 화면에서 받기"/);
  // 내 계정이 직접 만든 식별 QR일 때만 켜진다: 시연 손님 QR을 만들 때와 손님 화면이 넘긴 QR을 받을 때. 새 촬영·취소·완료에서는 꺼진다.
  assert.match(staff, /if \(!handedOver \|\| restore === 'found'\) return;\s*scanned\(handedOver, true\);/);
  // 카메라로 찍은 QR은 내 것이 아니다: scanned는 기본값 false로 플래그를 다시 쓴다.
  assert.match(staff, /function scanned\(raw: string, own = false\) \{[\s\S]*?setOwnIdentity\(own\);/);
  assert.match(staff, /onBarcodeScanned=\{\(\{ data \}\) => scanned\(data\)\}/);
  assert.match(staff.slice(staff.indexOf('async function startScan'), staff.indexOf('async function resolve(')), /setOwnIdentity\(false\)[\s\S]*function cancel\(\) \{[\s\S]*?setOwnIdentity\(false\)/);
  // 역할 전환은 기존 "고객으로 둘러보기" 경로(onBrowse)를 그대로 쓴다.
  assert.match(home, /onBrowseAsCustomer=\{props\.onBrowseAsCustomer\}/);
  assert.match(showcase, /onBrowseAsCustomer=\{onBrowse\}/);
  // 점주 쪽은 열릴 때 손님 화면이 넘긴 식별 QR을 한 번만 받아 촬영 결과와 같은 길로 보낸다.
  // 값은 넘긴 계정만 받고, 보관된 발급 복구를 다 읽은 뒤에만 받는다. 복구할 것이 있으면 넘어온 값은 버린다.
  assert.match(staff, /if \(!demoHandoff \|\| restore === 'reading'\) return;\s*const handedOver = takeDemoHandoff\('identity', accountId\);/);
  assert.match(staff, /\}, \[restore\]\);/);
  assert.match(staff, /const \[restore, setRestore\] = useState<'reading' \| 'none' \| 'found'>\(securePending \? 'reading' : 'none'\);/);
});

test('#412 점주 탭 목록은 웹에서만 주요 메뉴 내비게이션 랜드마크 안에 있다', () => {
  assert.match(home, /import \{ navigationLandmark \} from '@\/navigation\/floating-tab-bar';/);
  assert.match(home, /<View \{\.\.\.navigationLandmark\}>\s*<View accessibilityRole="tablist"/);
  assert.doesNotMatch(home, /role="navigation"|aria-label=/);
});
