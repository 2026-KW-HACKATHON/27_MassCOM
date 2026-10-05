import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks (not a renderer) for the same reason as collection/index.test.ts: this screen renders
// react-native views, which the node:test/esbuild runner cannot load.
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('pull-to-refresh refreshes the store list and progress filters on the search tab', () => {
  const pullToRefresh = screen.slice(screen.indexOf('refreshControl={'), screen.indexOf('ListHeaderComponent={'));
  assert.doesNotMatch(pullToRefresh, /onRefresh=\{refresh\}/);
  assert.match(pullToRefresh, /onRefresh=\{refreshAll\}/);
  const refreshAll = screen.slice(screen.indexOf('const refreshAll = useCallback'), screen.indexOf('}, [refresh]);'));
  assert.match(refreshAll, /void refresh\(\);/);
  assert.match(refreshAll, /setBadgeRefreshToken/);
  assert.match(screen, /refreshToken: badgeRefreshToken/);
});

// Issue #331: 탐색 목록의 메뉴 검색·업종 칩·진행 칩. 화면은 렌더러로 못 읽으니 소스를 검사하고, 규칙은 discovery-filters.test.ts가 맡는다.
const chips = readFileSync(new URL('./discovery-chips.tsx', import.meta.url), 'utf8');
const progressHook = readFileSync(new URL('./use-discovery-progress.ts', import.meta.url), 'utf8');

test('the search box names menus, and the list is filtered by search, category and progress together (#331)', () => {
  assert.match(screen, /title="가게 검색"/);
  assert.match(screen, /placeholder="이름·메뉴·주소로 찾기"/);
  assert.doesNotMatch(screen, /이름·주소·이야기로 찾기/);
  assert.match(screen, /applyMerchantFilters\(merchants, filters, filterContext\)/);
  assert.doesNotMatch(screen, /filterMerchants/);
  assert.match(screen, /const filtering = hasActiveFilters\(filters\);/);
});

test('the search tab keeps map access but does not render home-only cards', () => {
  assert.match(screen, /<MapChip \/>/);
  assert.match(screen, /href="\/map"/);
  for (const homeOnly of ['HomeRewardCard', 'RewardReveal', 'ExperienceEntry', 'HomeExploration', 'SignedInRewardCard', 'PassportChip', 'createRecommendationApiClient']) {
    assert.doesNotMatch(screen, new RegExp(homeOnly));
  }
  assert.doesNotMatch(screen, /href="\/friends"/);
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


test('검색 필터는 배지 책을 한 번 읽고 같은 갱신을 쓴다 (#354)', () => {
  assert.doesNotMatch(screen, /useBadgeBook\(|createBadgeApiClient\(/);
  assert.equal((progressHook.match(/useBadgeBook\(badgeApi\)/g) ?? []).length, 1);
  assert.match(progressHook, /badgeApi, refreshQuietly, applyOpened/);
});

test('가게 카드는 검색 목록 출처를 넘긴다 (#354)', () => {
  assert.match(screen, /params: \{ merchantId, from: 'list' \}/);
});
