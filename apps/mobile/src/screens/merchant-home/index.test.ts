import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('./index.tsx');
const status = read('./status.tsx');
const staff = read('../merchant-claim/staff.tsx');
const showcase = read('../showcase-merchant/index.tsx');

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

test('기존 기능 진입점과 전체 화면 발급·복구를 모두 유지한다', () => {
  for (const label of ['고객 화면으로', '빈 공간 투어', '권한 요청 관리', '로그아웃', '방문 확인', '오늘·현황', '가게 꾸미기']) assert.ok(home.includes(label), label);
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
