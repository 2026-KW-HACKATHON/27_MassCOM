import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks (react-native views can't go through the node:test/esbuild runner, see HANDOFF).
const source = readFileSync(new URL('./collectible-browser.tsx', import.meta.url), 'utf8');

test('both card types fill one column at large font scale and keep grades visible', () => {
  assert.match(source, /singleColumn = isLargeText\(fontScale\)/);
  assert.match(source, /<GroupCard[^>]*singleColumn=\{singleColumn\}/s);
  assert.match(source, /<LegacyCard[^>]*singleColumn=\{singleColumn\}/s);
  assert.equal((source.match(/singleColumn && styles\.groupCardFull/g) ?? []).length, 2);
  assert.match(source, /groupCard: \{ width: '48%'/);
  assert.match(source, /groupCardFull: \{ width: '100%'/);
  assert.match(source, /numberOfLines=\{2\}[^>]*groupName[^>]*>\{group\.artwork\.name\}/);
  assert.match(source, /numberOfLines=\{2\}[^>]*groupMeta[^>]*>\{group\.artwork\.gradeName\} · \{group\.merchantName\}/);
  assert.match(source, /numberOfLines=\{2\}[^>]*groupMeta[^>]*>\{detail\.gradeName\} · \{item\.merchantName\}/);
  assert.match(source, /numberOfLines=\{2\}[^>]*favoriteName[^>]*>\{group\.artwork\.name\}/);
  assert.match(source, /favoriteGrade[^>]*>\{group\.artwork\.gradeName\}/);
});

test('NFT label and value stack inside both cards and earned dates use the Korean date formatter', () => {
  assert.match(source, /<View style=\{styles\.nftSummary\}>\s*<Text style=\{collectionStyles\.nftLabel\}>실제 NFT<\/Text>\s*<Text style=\{collectionStyles\.nftValue\}>\{summary\}<\/Text>/);
  assert.match(source, /nftSummary: \{ alignItems: 'flex-start', gap: 2 \}/);
  // 날짜는 한국 날짜 계산을 쓰는 collectible-groups의 earnedDateLabel로만 만든다.
  assert.match(source, /earnedDateLabel/);
  assert.doesNotMatch(source, /iso\.slice\(0, 10\)/);
});

// PR #301 리뷰: 묶인 카드(같은 그림을 두 번 이상 받음)는 요약 배지(nftGroupSummary)만 보이고, 각 벌의 실제 상태·수령인·
// 토큰 정보를 볼 길이 없었다. 요약 줄과 민트 단추(첫 발행 가능한 벌 대상)는 유지한 채 펼쳐 볼 수 있게 했다.
test('NftStatusRow lets a grouped (duplicate) card expand to each entitlement\'s own status/recipient/token (#301 review)', () => {
  const row = source.slice(source.indexOf('function NftStatusRow'), source.indexOf('/** A collectible earned without a published picture'));
  assert.match(row, /entitlements\.length > 1/);
  assert.match(row, /setExpanded/);
  assert.match(row, /entitlements\.map\(\(entry, index\) =>/);
  assert.match(row, /nftStatusLabel\(entry\.nftStatus, mint\.nftMinting\)/);
  // The summary line and the single mint button (first mint-eligible entry) must stay, not be replaced.
  assert.match(row, /nftGroupSummary\(entitlements, mint\.nftMinting\)/);
  assert.match(row, /entitlements\.find\(\(entry\) => canOfferMint\(entry\.nftStatus, mint\.nftMinting\)\)/);
});

// Issue #314: this Pressable is the direct child of `<Link asChild>`, which renders through expo-router's <Slot>.
// Slot throws a render error (not just a warning) when a direct child receives an array-valued `style` — this was
// the true first failure behind the 도감 탭 white-screen crash for any account with an NFT-eligible, unbound-wallet
// collectible. See primary-tabs.test.ts for the same convention elsewhere in the app.
test('the "외부 지갑 주소 확인" Link child does not pass a style array to Expo Router Slot (#314)', () => {
  const link = source.match(/<Link href="\/wallet" asChild>([\s\S]*?)<\/Link>/)?.[1];
  assert.ok(link, 'wallet Link in NftStatusRow');
  const pressable = link.match(/<Pressable\b[^>]*>/)?.[0];
  assert.ok(pressable, 'Link direct Pressable child');
  assert.doesNotMatch(pressable, /style=\{\s*\[/, 'Expo Router Slot rejects array-valued child styles');
  assert.match(pressable, /style=\{StyleSheet\.flatten\(/);
});

test('grade materials share one collection clock and stop outside the focused foreground album (#349)', () => {
  assert.equal((source.match(/useGradeMaterialClock\(/g) ?? []).length, 1);
  assert.match(source, /materialActive = motionEnabled && focused && foreground && materialVisible/);
  assert.match(source, /materialScrollY=\{materialScrollY\}/);
  assert.match(source, /useAnimatedReaction\(/);
  assert.match(source, /measure\(ref\)/);
  assert.match(source, /if \(inView !== visible\) scheduleOnRN\(setVisible, inView\)/);
  assert.doesNotMatch(source, /useDerivedValue|visibleClock/);
  assert.match(source, /active=\{active && visible && \(material === 'gold' \|\| material === 'prism'\)\}/);
});

test('grouped, featured, and legacy thumbnails use the same card material overlay (#349)', () => {
  assert.equal((source.match(/<MaterialThumbnail /g) ?? []).length, 3);
  assert.match(source, /gradeMaterialFor\(group\.artwork\.gradeId, group\.artwork\.gradeName\)/);
  assert.match(source, /gradeMaterialFor\(detail\.gradeId, detail\.gradeName\)/);
});

test('unowned series goals link to their merchant detail from the collection', () => {
  const series = source.slice(source.indexOf('{series.length > 0 ? ('), source.indexOf('function GroupCard'));
  assert.match(series, /slot\.owned \? \(/);
  assert.match(series, /merchantId: store\.merchantId, from: 'collection'/);
  assert.match(series, /accessibilityRole="link"/);
  assert.match(series, /StyleSheet\.flatten\(\[styles\.seriesSlot/);
});

test('an acquired collectible can show its store using the entitlement merchant id', () => {
  const detail = readFileSync(new URL('./collectible-detail.tsx', import.meta.url), 'utf8');
  const collection = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(collection, /collection\?\.collectibles\.find\(\(item\) => item\.entitlementId === collectibleDetail\.entitlementId\)\?\.merchantId/);
  assert.match(detail, /accessibilityRole="link" accessibilityLabel=\{`\$\{merchantName\} 보기`\}/);
  assert.match(detail, /params: \{ merchantId, from: 'collection' \}/);
});
