import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks (not a renderer) for the same reason as collection/index.test.ts: this screen renders
// react-native views, which the node:test/esbuild runner cannot load.
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

// PR #301 리뷰: 홈 보상 카드가 `onOpenFailed`를 넘기지 않아, 보상 열기가 거절돼도(예: 마지막 쿠폰 소진) 배지 책을
// 다시 읽지 않았다 — 그 상자가 계속 READY로 보여 homeFeaturedReward가 같은 상자만 돌려주고 다음 READY 상자를 가렸다.
test('the home reward card wires onOpenFailed through to a quiet badge refresh (#301 review)', () => {
  assert.match(screen, /<HomeRewardCard book=\{book\} onOpen=\{badgeApi\.openReward\} onRevealed=\{onRevealed\} onOpenFailed=\{onOpenFailed\} \/>/);
  const onOpenFailed = screen.slice(screen.indexOf('const onOpenFailed = useCallback'), screen.indexOf('const onRevealed = useCallback'));
  assert.match(onOpenFailed, /shouldRefreshBadgesQuietly\(code\)/);
  assert.match(onOpenFailed, /void refreshQuietly\(\);/);
});

// PR #301 리뷰: 당겨서 새로고침이 음식점 목록만 다시 받고 배지 책(여권 칩·보상 카드)은 그대로였다.
test('pull-to-refresh also refreshes the badge book, not just the store list (#301 review)', () => {
  const pullToRefresh = screen.slice(screen.indexOf('refreshControl={'), screen.indexOf('ListHeaderComponent={'));
  assert.doesNotMatch(pullToRefresh, /onRefresh=\{refresh\}/);
  assert.match(pullToRefresh, /onRefresh=\{refreshAll\}/);
  const refreshAll = screen.slice(screen.indexOf('const refreshAll = useCallback'), screen.indexOf('}, [refresh]);'));
  assert.match(refreshAll, /void refresh\(\);/);
  assert.match(refreshAll, /setBadgeRefreshToken/);
  assert.match(screen, /refreshToken: badgeRefreshToken/);
  assert.match(screen, /PassportChip copy="내 탐험 여권 보기" data=\{passportChipData\(discovery\.book\)\}/);
  assert.match(screen, /SignedInRewardCard book=\{discovery\.book\}/);
});

// Issue #331: 탐색 목록의 메뉴 검색·업종 칩·진행 칩. 화면은 렌더러로 못 읽으니 소스를 검사하고, 규칙은 discovery-filters.test.ts가 맡는다.
const chips = readFileSync(new URL('./discovery-chips.tsx', import.meta.url), 'utf8');
const progressHook = readFileSync(new URL('./use-discovery-progress.ts', import.meta.url), 'utf8');

test('the search box names menus, and the list is filtered by search, category and progress together (#331)', () => {
  assert.match(screen, /placeholder="이름·메뉴·주소로 찾기"/);
  assert.doesNotMatch(screen, /이름·주소·이야기로 찾기/);
  assert.match(screen, /applyMerchantFilters\(merchants, filters, filterContext\)/);
  assert.doesNotMatch(screen, /filterMerchants/);
  assert.match(screen, /const filtering = hasActiveFilters\(filters\);/);
});

test('progress chips need a signed-in account and loaded data, and a choice whose chip vanished is cleared (#331)', () => {
  assert.match(screen, /const signedIn = Boolean\(auth\.credential && auth\.accountId\);/);
  assert.match(screen, /progressChipOptions\(\{ signedIn, collectionReady: discovery\.collection !== undefined, badgesReady: discovery\.book !== undefined \}\)/);
  assert.match(screen, /keepAvailableFilters\(\{ query, category, progress \}, \{ categories: categoryOptions, progressOptions \}\)/);
  assert.match(screen, /if \(filters\.category !== category\) setCategory\(filters\.category\);/);
  assert.match(screen, /if \(filters\.progress !== progress\) setProgress\(filters\.progress\);/);
  assert.match(screen, /onProgress=\{\(next\) => setProgress\(toggleProgress\(filters\.progress, next\)\)\}/);
  // The chips live with the search field, so they only exist once the catalog has loaded.
  assert.match(screen, /merchants\.length > 0 \? \(\s*<View style=\{styles\.discoveryTools\}>[\s\S]*?<DiscoveryChips[\s\S]*?<View style=\{styles\.sectionHeading\}>/);
});

test('an empty result names the active filters and clears all of them (#331)', () => {
  assert.match(screen, /title=\{emptyCopy\.title\}/);
  assert.match(screen, /body=\{emptyCopy\.body\}/);
  assert.match(screen, /action=\{\{ label: emptyCopy\.actionLabel, onPress: clearFilters \}\}/);
  const clear = screen.slice(screen.indexOf('const clearFilters = useCallback'), screen.indexOf('}, []);', screen.indexOf('const clearFilters = useCallback')));
  assert.match(clear, /setQuery\(''\);/);
  assert.match(clear, /setCategory\(null\);/);
  assert.match(clear, /setProgress\(null\);/);
});

test('the chips are buttons that announce selection, with a 전체 category chip (#331)', () => {
  assert.match(chips, /accessibilityRole="button"/);
  assert.match(chips, /accessibilityState=\{\{ selected \}\}/);
  assert.match(chips, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(chips, /label="전체" accessibilityLabel="업종 전체" selected=\{category === null\}/);
  assert.match(chips, /ScrollView horizontal/);
  assert.match(chips, /categories\.length > 0/);
  assert.match(chips, /progressOptions\.length > 0/);
  // Selection is shown by a mark as well as by colour.
  assert.match(chips, /selected \? `✓ \$\{label\}` : label/);
  assert.match(chips, /styles\.discoveryChip,/);
});

test('discovery data reuses the collection and badge-book reads: no new endpoint, and it refreshes with the pull-to-refresh (#331)', () => {
  assert.match(progressHook, /useTownCollection\(\{ apiUrl, credential, onSessionInvalid \}\)/);
  assert.match(progressHook, /useBadgeBook\(badgeApi\)/);
  assert.match(progressHook, /credential \? createBadgeApiClient\(\{ apiUrl, credential, onSessionInvalid \}\) : undefined/);
  assert.doesNotMatch(progressHook, /fetch\(|createCommerceApiClient/);
  assert.match(progressHook, /void reload\(\);\s*void refreshQuietly\(\);/);
  assert.match(screen, /refreshToken: badgeRefreshToken/);
  assert.match(progressHook, /book: credential \? book : undefined/);
});


test('홈 여권·보상·필터는 배지 책을 한 번 읽고 같은 갱신을 쓴다 (#354)', () => {
  assert.doesNotMatch(screen, /useBadgeBook\(|createBadgeApiClient\(/);
  assert.equal((progressHook.match(/useBadgeBook\(badgeApi\)/g) ?? []).length, 1);
  assert.match(screen, /refreshQuietly=\{discovery\.refreshQuietly\} applyOpened=\{discovery\.applyOpened\}/);
  assert.match(progressHook, /badgeApi, refreshQuietly, applyOpened/);
});

test('홈 다음 목표는 서버 첫 추천을 사용하고 출처를 넘긴다 (#354)', () => {
  assert.match(screen, /item: items\[0\]/);
  assert.match(screen, /bestNextGoal = signedIn && nextGoal\?\.api === recommendationApi/);
  assert.match(screen, /from: 'recommendation'/);
  assert.match(screen, /accessibilityHint="추천 가게 상세 보기"/);
  assert.match(screen, /params: \{ merchantId, from: 'list' \}/);
  assert.match(screen, /return \(\) => controller\.abort\(\)/);
});
