import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

test('every animated piece respects reduced motion', () => {
  for (const file of ['sky-art.tsx', 'floating-card.tsx', 'bounce-button.tsx', 'mascot.tsx', 'stagger.tsx']) {
    assert.match(read(file), /useMotionEnabled\(\)/, file);
  }
});

test('stagger never strands content: no layout animation, a failsafe, and late rows render at once', () => {
  const stagger = read('stagger.tsx');
  // The claim tab once rendered only its header: content wrapped in an `entering` layout animation stayed at opacity 0.
  assert.doesNotMatch(stagger, /entering=/);
  assert.match(stagger, /index >= STAGGER_LIMIT/);
  assert.match(stagger, /setTimeout\(\(\) => progress\.set\(1\)/);
  assert.match(stagger, /clearTimeout\(/);
});

test('buttons and pressable cards tint their background while pressed, not their text', () => {
  const button = read('bounce-button.tsx');
  assert.match(button, /\(\{ pressed \}\) =>/);
  assert.match(button, /pressed \? \(variant === 'primary' \? styles\.primaryButtonPressed : styles\.secondaryButtonPressed\) : null/);
  const card = read('floating-card.tsx');
  assert.match(card, /\(\{ pressed \}\) =>/);
  assert.match(card, /pressed \? styles\.cardPressed : null/);
  for (const source of [button, card]) assert.doesNotMatch(source, /opacity: pressed/);
});

test('the dark card highlight never overrides a border the caller draws (the dashed claim panels keep their top edge)', () => {
  const card = read('floating-card.tsx');
  assert.match(card, /flat\?\.borderWidth === undefined && flat\?\.borderTopWidth === undefined \? styles\.cardEdge : null/);
  assert.match(card, /StyleSheet\.flatten\(\[styles\.card, edge, flat\]\)/);
  assert.match(card, /styles\.card, edge, inner/);
});

test('a pressable card lays out like a static one: layout props on the Pressable, visuals on the card', () => {
  const card = read('floating-card.tsx');
  assert.match(card, /splitCardStyle\(/);
  assert.match(card, /<Pressable[\s\S]*?style=\{outer\}/);
  assert.match(card, /styles\.card, edge, inner/);
});

test('screen copy fits its space and does not repeat the heading below it', () => {
  const list = readSource('screens/real-map/index.tsx');
  assert.match(list, /title="탐색" subtitle="가게와 코스 찾기"/);
  assert.match(list, /placeholder="가게 이름·주소 검색"/);
  assert.doesNotMatch(list, /어디로 탐험할까요|내 탐험 여권 보기|도감에서 내 도장 보기/);
  const home = readSource('screens/home/index.tsx');
  assert.match(home, /<AppHeader title="홈" showFriendsEntry showMailEntry compact/);
  assert.doesNotMatch(home, /<HomeCollectionDisplay/);
  assert.equal((readSource('screens/home/home-exhibit.tsx').match(/<HomeCollectionDisplay/g) ?? []).length, 1);
  const collection = readSource('screens/collection/index.tsx');
  // #296 Option A: a compact passport strip now sits in the header as a child (replacing the self-closing tag).
  assert.match(collection, /<AppHeader title="도감" subtitle="가본 가게마다 도장이 찍혀요" avatarArt=\{companionArt\} compact>/);
  // The passport hero under the header already says "나의 탐험 여권".
  assert.doesNotMatch(collection, /<AppHeader title="나의 탐험 여권"/);
});

test('the profile strip keeps identity, mileage, mail and settings one tap away', () => {
  const header = read('app-header.tsx');
  const strip = read('profile-strip.tsx');
  assert.match(header, /<ProfileStrip avatarArt=\{avatarArt\} avatarClothing=\{avatarClothing\} avatarContent=\{avatarContent\} \/>/);
  for (const route of ['/profile', '/shop', '/mail', '/settings']) assert.ok(strip.includes(`href="${route}"`), route);
  // The three reads (friends, shop, social) moved into the discovery provider, one set per focus for the whole app.
  assert.doesNotMatch(strip, /getFriends\(\)|getShop\(\)|getSocial\(\)|createFriendsApiClient|createSocialApiClient/);
  const calls = read('../discovery/discovery-calls.ts');
  assert.match(calls, /friends\.getFriends\(\)/);
  assert.match(calls, /shop\.getShop\(\)/);
  assert.match(calls, /social\.getSocial\(\)/);
  // Mileage chip from the first coin; mail icon only with unread mail or the friends/mail opt-in.
  assert.match(strip, /\{atLeast\(stage, 'after-first'\) \? <Link href="\/shop" asChild>/);
  assert.match(strip, /\{mailEntryVisible\(optIn, data\.unread\) \? <Link href="\/mail" asChild>/);
  // 44dp touch floor, and the identity moves to a row of its own (full text) at large type and in a narrow, zoomed-in window.
  assert.match(strip, /mileage: \{[^}]*minHeight: uiMetrics\.minTouchCompact/);
  assert.match(strip, /import \{ isLargeText, isNarrow \} from '\.\/large-text';/);
  assert.match(strip, /const wrap = isLargeText\(fontScale\) \|\| isNarrow\(width\);/);
  assert.match(strip, /\[styles\.row, wrap && \{ flexWrap: 'wrap' \}\]/);
  assert.match(strip, /wrap && \{ flexBasis: '100%' \}/);
  assert.equal((strip.match(/numberOfLines=\{wrap \? undefined : 1\}/g) ?? []).length, 2, 'nickname and intro');
  const home = readSource('screens/home/index.tsx');
  assert.match(home, /<AppHeader title="홈"/);
  assert.match(home, /showFriendsEntry showMailEntry/);
});

test('large text grows freely with reflow while home keeps one exhibit and claim decoration shrinks', () => {
  const header = read('app-header.tsx');
  assert.doesNotMatch(header, /styles\.headerTitle[^>]*maxFontSizeMultiplier|styles\.headerSubtitle[^>]*numberOfLines/);
  assert.match(header, /\{subtitle \? <Text style=\{styles\.headerSubtitle\}>\{subtitle\}<\/Text> : null\}/);
  assert.match(read('profile-strip.tsx'), /flexWrap: 'wrap'/);
  assert.doesNotMatch(read('bounce-button.tsx'), /maxFontSizeMultiplier|numberOfLines/);
  const home = readSource('screens/home/index.tsx');
  const exhibit = readSource('experience/home-collection-display.tsx');
  assert.doesNotMatch(home, /heroMascotSize|<Mascot/);
  assert.equal((home.match(/<StudioScene/g) ?? []).length, 1, 'one room preview');
  assert.doesNotMatch(home, /<HomeCollectionDisplay/);
  assert.equal((readSource('screens/home/home-exhibit.tsx').match(/<HomeCollectionDisplay/g) ?? []).length, 1);
  assert.equal((exhibit.match(/<CompanionScene/g) ?? []).length, 1);
  assert.match(exhibit, /showcase: \{[^}]*flexWrap: 'wrap'/);
  assert.match(readSource('screens/claim-redeem/index.tsx'), /size=\{heroMascotSize\(fontScale, 112\)\}/);
});

test('the claim hero tells people what to show or type', () => {
  const claim = readSource('screens/claim-redeem/index.tsx');
  assert.match(claim, /직원에게 내 QR을 보여주거나, 점주 코드를 입력해요/);
  assert.doesNotMatch(claim, /점주에게 받은 QR을 촬영하거나 1회 코드를 입력하세요/);
});

test('header titles and back controls remain separate from the profile strip', () => {
  const header = read('app-header.tsx');
  assert.match(header, /<ProfileStrip[^>]*\/>[\s\S]*?accessibilityRole="header"/);
  const back = read('back-header.tsx');
  assert.match(back, /<ProfileStrip \/>[\s\S]*?accessibilityLabel="뒤로"[\s\S]*?styles\.backTitle/);
});

test('the header art fades into the page colour over its last 15% in both schemes', () => {
  const art = read('sky-art.tsx');
  assert.match(art, /SEAM_FRACTION = 0\.15/);
  assert.match(art, /id="seam"/);
  // Below the art the page is sky[1] (world.page), so the gradient, the dusk overlay and the seam all end on it, never on sky[2].
  assert.doesNotMatch(art, /sky\[2\]/);
  assert.equal((art.match(/world\.page/g) ?? []).length >= 3, true, 'gradient end, dusk end and seam all use the page colour');
  // The seam overlay is drawn for every scheme: it must not live inside the dark-only branch.
  const seam = art.indexOf('id="seam"');
  const dark = art.indexOf('{dark ? (');
  const darkEnd = art.indexOf(') : null}', dark);
  assert.ok(seam < dark || seam > darkEnd, 'seam overlay is inside the dark-only branch');
});

test('the page under the header art, and the tab scenes, are painted world.page', () => {
  assert.match(read('sky-backdrop.tsx'), /backgroundColor: world\.page/);
  assert.match(readSource('app/(tabs)/_layout.tsx'), /sceneStyle: \{ backgroundColor: world\.page \}/);
});

test('content that scrolls under the status bar sits behind a page-coloured scrim that fades in, and RefreshControls start below it', () => {
  const scrim = read('status-bar-scrim.tsx');
  assert.match(scrim, /pointerEvents="none"/);
  assert.match(scrim, /height: insets\.top/);
  assert.match(scrim, /withAlpha\(world\.sky\[2\], world\.statusScrimAlpha\)/);
  // Fades with the scroll offset; with reduced motion it only toggles.
  assert.match(scrim, /interpolate\(/);
  assert.match(scrim, /useMotionEnabled\(\)/);
  assert.match(scrim, /scrollY\.get\(\)/);
  // Every scrolling sky screen carries it: the shared scroll view and the explore list.
  assert.match(read('sky-scroll-view.tsx'), /<StatusBarScrim scrollY=\{scrim\.scrollY\} \/>/);
  const list = readSource('screens/real-map/index.tsx');
  assert.match(list, /state\.mode==='list' \? <View[\s\S]*?<ScrollView[^>]*onScroll=\{scrim\.onScroll\}[\s\S]*?\{controls\}\{panels\}[\s\S]*?<\/ScrollView>/);
  assert.match(list, /onScroll=\{scrim\.onScroll\}/);
  assert.match(list, /<StatusBarScrim scrollY=\{scrim\.scrollY\} \/>/);
  // A pull-to-refresh spinner would otherwise appear behind the status bar.
  let controls = 0;
  for (const file of sourceFiles(fileURLToPath(new URL('../screens/', import.meta.url))).filter((path) => path.endsWith('.tsx'))) {
    for (const control of readFileSync(file, 'utf8').match(/<RefreshControl[\s\S]*?\/>/g) ?? []) {
      controls += 1;
      assert.match(control, /progressViewOffset=\{insets\.top\}/, `${file} RefreshControl`);
    }
  }
  assert.equal(controls, 20, '기존 화면과 가게 코인 상점·코인 도감·방 탐험·코스의 새로고침은 모두 상태 표시줄 아래에 둔다');
  assert.equal((readSource('screens/merchant-home/status.tsx').match(/<RefreshControl/g) ?? []).length, 1, '점주 현황에 하나의 당겨서 새로 고침을 둔다');
  assert.equal((readSource('screens/merchant-claim/staff.tsx').match(/<RefreshControl/g) ?? []).length, 1, '방문 확인에 발급 상태 새로 고침을 둔다');
  // PR #312 QA: Android의 elevation은 JSX 순서와 별개로 Z 스택을 정한다. 카드류(ui/styles.ts의 card)가 쓰는
  // elevation보다 스크림의 elevation이 뚜렷이 더 커야, 스크롤이 지난 카드가 스크림 위로 올라와 그 텍스트가
  // 상태 바 아이콘 자리에 다시 비치지 않는다.
  const cardElevation = Number(readSource('ui/styles.ts').match(/card: \{[\s\S]*?elevation: (\d+)/)?.[1]);
  const scrimElevation = Number(scrim.match(/scrim: \{[\s\S]*?elevation: (\d+)/)?.[1]);
  assert.ok(Number.isInteger(cardElevation) && cardElevation > 0, 'base card elevation found');
  assert.ok(scrimElevation > cardElevation, `scrim elevation (${scrimElevation}) must exceed every card's (${cardElevation})`);
  // elevation만 Z 순서에 쓰고 Android의 네이티브 드롭 섀도는 받지 않는다 — 안 그러면 스크림 밑에 옅은 그림자 선이
  // 생긴다(PR #312 리뷰, Claude P1).
  assert.match(scrim, /scrim: \{[\s\S]*?shadowColor: 'transparent'/);
});

test('the shared sky backdrop paints the page while headers stay inside scroll content', () => {
  assert.doesNotMatch(read('sky-backdrop.tsx'), /skyTownHeader|<Image|<SkyArt/);
  assert.doesNotMatch(read('app-header.tsx'), /<SkyArt/);
  assert.doesNotMatch(read('back-header.tsx'), /<SkyArt/);
  // The header renders inside the scroll view, before the content, so both scroll away together.
  assert.match(read('sky-scroll-view.tsx'), /<ScrollView[\s\S]*\{header\}[\s\S]*<\/ScrollView>/);
});

test('SkyScrollView forwards refreshControl (and other ScrollView props) to the native ScrollView unchanged (PR #312 리뷰 라운드 6)', () => {
  // 기기 QA: 상점의 당겨서 새로고침이 의심받았다 — 실제로는 `{...rest}`로 그대로 전달돼 멀쩡하다. `refreshControl`을
  // 따로 분해해 어딘가 다른 곳에 두면(예: 새 기능 추가 중) 당겨도 아무 일도 없는 것처럼 보이는 회귀가 생긴다.
  const source = read('sky-scroll-view.tsx');
  const props = source.slice(source.indexOf('{ header, onHeaderLayout'), source.indexOf(') {'));
  assert.doesNotMatch(props, /refreshControl/, 'refreshControl은 구조분해하지 않고 ...rest로 그대로 넘긴다');
  assert.match(source, /<ScrollView[\s\S]*\{\.\.\.rest\}[\s\S]*<\/ScrollView>/);
});

test('no tab screen, the settings page or a stack page pins its header outside the scroll content', () => {
  const screens = [
    'screens/collection/index.tsx', 'screens/claim-redeem/index.tsx',
    'screens/account-settings/index.tsx', 'screens/merchant-detail/index.tsx', 'screens/recommendations/index.tsx',
    'screens/town-map/index.tsx', 'screens/friends/index.tsx', 'screens/friends/passport.tsx', 'screens/shop/index.tsx',
  ];
  for (const file of screens) {
    const source = readSource(file);
    // The scroll view's own header prop, the list's header component, or the first child of a plain ScrollView.
    assert.match(source, /header=\{|ListHeaderComponent=\{|<ScrollView[^>]*>\s*<BackHeader/, `${file} puts its header inside the scroll content`);
    assert.doesNotMatch(source, /<SkyBackdrop>\s*<(?:AppHeader|BackHeader)/, `${file} draws its header above the scroller`);
  }
  assert.match(readSource('screens/merchant-list/index.tsx'), /<RealMapScreen[^>]*initialMode="list"/);
  // Route files only pass a header down; they never sit one above the screen.
  for (const file of ['app/(tabs)/claim.tsx', 'app/(tabs)/collection.tsx', 'app/(tabs)/index.tsx', 'app/(tabs)/map.tsx', 'app/(tabs)/settings.tsx', 'app/(tabs)/shop.tsx', 'app/(tabs)/friends.tsx', 'app/friends/[friendshipId].tsx']) {
    const source = readSource(file)
      .replace(/header=\{<(?:AppHeader|BackHeader)[^>]*\/>\}/g, '')
      .replace(/const header = <(?:AppHeader|BackHeader)[^>]*\/>;/, '')
      // #298: 친구 route now builds its BackHeader with a mascot child (multi-line, not self-closing) — still just a
      // value assigned to `header` and handed down, never rendered directly above the screen.
      .replace(/const header = \(\s*<(?:AppHeader|BackHeader)[\s\S]*?<\/(?:AppHeader|BackHeader)>\s*\);/, '');
    assert.doesNotMatch(source, /<(?:AppHeader|BackHeader)/, `${file} pins a header`);
  }
});

test('stack pages use the sky header with a back button instead of the plain native header', () => {
  const layout = readSource('app/_layout.tsx');
  assert.match(layout, /name="merchants\/\[merchantId\]" options=\{\{ headerShown: false \}\}/);
  assert.match(layout, /name="recommendations" options=\{\{ headerShown: false \}\}/);
  assert.match(layout, /name="friends\/\[friendshipId\]" options=\{\{ headerShown: false \}\}/);
  const detail = readSource('screens/merchant-detail/index.tsx');
  // The loading, error and empty states keep the way back too.
  assert.ok((detail.match(/<BackHeader title="가게 상세"/g) ?? []).length >= 2, 'detail page and its state frame');
  assert.match(readSource('screens/recommendations/index.tsx'), /<BackHeader title="다음 가게 추천"/);
  assert.match(detail, /<BackHeader title="가게 상세"\/>/);
  assert.match(detail, /photos\.filter\(photo=>photo\.id!==leadPhoto\?\.id&&publishedPhotoUri\(apiUrl,photo\.url\)\)/);
  assert.match(detail, /AI 생성 수집품 그림 · 실제 가게 사진과 다릅니다/);
  assert.match(detail, /<Image source=\{\{uri:goal\.thumbnailDataUrl\}\}/);
  const back = read('back-header.tsx');
  assert.match(back, /art \? <StoreArt source=\{art\}/);
  assert.match(back, /<ProfileStrip \/>/);
});

test('signed-out and set-up states of the tab routes sit on the sky under their own header, not on a white sheet', () => {
  for (const [file, title] of [
    ['app/(tabs)/claim.tsx', '방문 인증'], ['app/(tabs)/collection.tsx', '도감'], ['app/(tabs)/index.tsx', '홈'],
  ] as const) {
    const source = readSource(file);
    assert.ok(source.includes(`<AppHeader title="${title}"`), `${file} header`);
    assert.match(source, /<SkyBackdrop>\s*<SkyScrollView header=\{header\}>/, `${file} set-up notice`);
    if (!file.endsWith('index.tsx')) assert.match(source, /<SkyBackdrop><AuthRequiredRoute header=\{header\} \/><\/SkyBackdrop>/, `${file} sign-in prompt`);
  }
});

test('every state of the collection measures its header and clears the tab bar', () => {
  const sky = readSource('screens/collection/index.tsx').match(/const sky = [\s\S]*?\n  \);/)?.[0];
  assert.ok(sky, 'sky() wrapper for the loading and error states');
  // focus=rewards scrolls to headerHeight + the section's y, and the last card must not hide behind the floating bar.
  assert.match(sky, /onHeaderLayout=\{setHeaderHeight\}/);
  assert.match(sky, /paddingBottom: clearance/);
});

test('the search header keeps one short task instead of home exploration copy', () => {
  const list = readSource('screens/real-map/index.tsx');
  assert.match(list, /title="탐색" subtitle="가게와 코스 찾기"/);
  assert.doesNotMatch(list, /어디로 탐험할까요/);
  assert.doesNotMatch(list, /오늘은 어디를 탐험할까요/);
});

test('a state scene draws its own card, announces errors politely, and callers do not add a second card', () => {
  const scene = read('state-scene.tsx');
  assert.match(scene, /framed = true/);
  assert.match(scene, /<FloatingCard>\{content\}<\/FloatingCard>/);
  // Loading and error appear on their own and should be announced; an empty result is only shown.
  assert.match(scene, /accessibilityLiveRegion=\{kind === 'empty' \? 'none' : 'polite'\}/);
  for (const file of ['screens/collection/index.tsx', 'screens/merchant-list/index.tsx', 'screens/merchant-detail/index.tsx']) {
    assert.doesNotMatch(readSource(file), /<FloatingCard[^>]*>\s*<StateScene/, `${file} wraps a StateScene in a second card`);
  }
});

test('state scenes map to the right mascot', () => {
  const scene = read('state-scene.tsx');
  assert.match(scene, /empty: 'sleep'/);
  assert.match(scene, /error: 'puzzled'/);
  assert.match(scene, /loading: 'search'/);
});

test('mascots are plain images unless asked to be interactive, and the exhibit has one accessible greeting', () => {
  const mascot = read('mascot.tsx');
  assert.match(mascot, /interactive = false/);
  assert.match(mascot, /mascotAccessibility\(accessibilityLabel, interactive\)/);
  // Without `interactive` the mascot is a bare Animated.Image: no Pressable, no wiggle handler.
  assert.match(mascot, /if \(!interactive\) return <Animated\.Image \{\.\.\.picture\} \{\.\.\.a11y\} \/>;/);
  assert.match(mascot, /<Pressable onPress=\{wiggle\} \{\.\.\.a11y\}>/);
  // The overview companion is a small static cue; only the full exhibit greets on tap.
  const home = readSource('screens/home/index.tsx');
  const exhibit = readSource('experience/home-collection-display.tsx');
  assert.doesNotMatch(home, /<Mascot|<AvatarPortrait|interactive/);
  assert.equal((home.match(/<StudioScene/g) ?? []).length, 1);
  assert.equal((exhibit.match(/<CompanionScene/g) ?? []).length, 1);
  assert.match(exhibit, /<CompanionScene[^>]*interactive/);
  const portrait = readSource('illustration/avatar-portrait.tsx');
  assert.match(portrait, /interactive \? <Pressable accessibilityRole="button" accessibilityLabel="동행과 인사하기"/);
  // Standalone foundation/claim heroes retain their original interaction contracts.
  assert.match(readSource('screens/foundation/index.tsx'), /<Mascot interactive pose="wave"/);
  assert.match(readSource('screens/claim-redeem/index.tsx'), /<Mascot interactive pose="stamp"/);
  // Claim remains decorative; home's explicit greeting and the role screen's wave are announced buttons.
  for (const file of ['screens/claim-redeem/index.tsx']) {
    const hero = readSource(file).match(/<Mascot\s+interactive[\s\S]*?\/>/)?.[0];
    assert.ok(hero, `${file} hero mascot`);
    assert.doesNotMatch(hero, /accessibilityLabel/, `${file} hero mascot is decorative`);
  }
  assert.match(readSource('screens/foundation/index.tsx'), /<Mascot interactive pose="wave"[^>]*accessibilityLabel=/);
  // On web the labelled heroes become decoration (tabIndex -1 + aria-hidden); the native announced button is unchanged.
  assert.match(read('mascot.tsx'), /decorativeOnWeb/);
  assert.match(read('mascot.tsx'), /Platform\.OS === 'web' && decorativeOnWeb \? undefined : labelProp/);
  assert.doesNotMatch(read('state-scene.tsx'), /interactive/);
  assert.doesNotMatch(readSource('gamification/celebration.tsx'), /<Mascot[^>]*interactive/);
  assert.doesNotMatch(readSource('gamification/reward-reveal.tsx'), /<Mascot[^>]*interactive/);
});


test('passport stamp page tilts each visited stamp by merchant and labels every slot', () => {
  const page = read('passport-stamp-page.tsx');
  assert.match(page, /stampTilt\(stamp\.merchantId\)/);
  // Status and goal live in the label; the hint is only what a tap does.
  assert.match(page, /accessibilityLabel=\{stamp\.label\}/);
  assert.match(page, /accessibilityHint="음식점 상세 보기"/);
  assert.match(page, /world\.paper/);
});

test('a visited stamp shows the showcase illustration when there is one, else the short glyph', () => {
  const page = read('passport-stamp-page.tsx');
  assert.match(page, /merchantArtSource\(\{ id: stamp\.merchantId, artUrl: stamp\.artUrl \}, apiUrl\)/);
  assert.match(page, /styles\.stampArt/);
  assert.match(page, /\{stamp\.glyph\}/);
  assert.doesNotMatch(page, /Array\.from\(stamp\.name\)\.slice\(0, 2\)/);
});

test('cards read their story, campaign, reason and progress aloud; the tap is only a hint', () => {
  for (const [file, label, hint] of [
    ['screens/recommendations/index.tsx', 'recommendationLabel(item)', 'recommendationHint()'],
  ] as const) {
    const source = readSource(file);
    assert.ok(source.includes(`accessibilityLabel={${label}}`), `${file} label`);
    assert.ok(source.includes(`accessibilityHint={${hint}}`), `${file} hint`);
  }
  const discovery = readSource('screens/real-map/index.tsx');
  assert.match(discovery, /accessibilityLabel=\{`\$\{publicDataDemoStoreName\(merchant\.id, merchant\.name\)\}, \$\{merchant\.roadAddress\}/);
  assert.match(discovery, /accessibilityHint="상세 보기와 코스 추가 동작이 있습니다"/);
  assert.match(read('floating-card.tsx'), /accessibilityHint=\{accessibilityHint\}/);
});

test('the collection says 도장 for the passport page, not 스탬프', () => {
  const collection = readSource('screens/collection/index.tsx');
  assert.doesNotMatch(collection, /스탬프/);
  assert.equal((collection.match(/title="도장판"/g) ?? []).length, 4, 'error, loading, ready and empty sections');
  assert.match(collection, /note=\{`도장 \$\{stampSlots\.filter/);
});

test('the search tab no longer owns the badge book; home owns the mission reward box', () => {
  const list = readSource('screens/merchant-list/index.tsx');
  const progress = readSource('screens/merchant-list/use-discovery-progress.ts');
  const home = readSource('screens/home/index.tsx');
  assert.match(progress, /useBadgeBook\(badgeApi\)/);
  assert.match(progress, /createBadgeApiClient\(/);
  assert.doesNotMatch(list, /passportChipData\(|<PassportChip|HomeRewardCard|RewardReveal/);
  assert.match(home, /<HomeRewardCard book=\{book\} onOpen=\{badgeApi\.openReward\}/);
  assert.match(home, /\[1, 3, 5\]\.map/);
  assert.doesNotMatch(list, /useBadgeBook\(/);
  assert.doesNotMatch(list, /stampOrange/);
});

test('passport stamp page reuses the collection stamp grid model and honours reduced motion', () => {
  const page = read('passport-stamp-page.tsx');
  assert.match(page, /from '@\/screens\/collection\/collection-stamps'/);
  assert.match(page, /stampColumnCount\(/);
  assert.match(page, /useMotionEnabled\(\)/);
  // A slot's Link child must not receive a style array (#216).
  assert.match(page, /StyleSheet\.flatten\(/);
});

const readSource = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

/** Argument text of every `hook(...)` call, found by matching parentheses. */
function callArguments(source: string, hook: string): string[] {
  const found: string[] = [];
  for (let at = source.indexOf(`${hook}(`); at !== -1; at = source.indexOf(`${hook}(`, at + 1)) {
    const start = at + hook.length + 1;
    let depth = 1;
    let end = start;
    while (depth > 0 && end < source.length) {
      if (source[end] === '(') depth += 1;
      if (source[end] === ')') depth -= 1;
      end += 1;
    }
    found.push(source.slice(start, end - 1));
  }
  return found;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

/** Identifiers a file imports from anywhere but reanimated: plain JS that does not exist on the UI runtime. */
function nonWorkletImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^;]+?)\s+from\s+'([^']+)'/g)) {
    if (match[2] === 'react-native-reanimated') continue;
    for (const name of match[1]!.matchAll(/[A-Za-z_$][\w$]*/g)) if (name[0] !== 'type' && name[0] !== 'as') names.push(name[0]);
  }
  return names;
}

test('animated style worklets only touch shared values and captured numbers, never imported JS helpers', () => {
  // Calling a plain JS function inside useAnimatedStyle crashed the collection tab on device:
  // "[Worklets] Tried to synchronously call a Remote Function stampTilt on the UI Runtime".
  // Every screen and component, not a hand-kept list: a new animated piece anywhere is covered without touching this test.
  const files = sourceFiles(fileURLToPath(new URL('../', import.meta.url))).filter((file) => file.endsWith('.tsx'));
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const imported = nonWorkletImports(source);
    for (const hook of ['useAnimatedStyle', 'useAnimatedProps']) {
      for (const body of callArguments(source, hook)) {
        checked += 1;
        for (const name of imported) {
          assert.doesNotMatch(body, new RegExp(`(?<![\\w$.])${name.replace('$', '\\$')}\\s*\\(`), `${file}: ${hook} callback calls ${name}()`);
        }
      }
    }
  }
  assert.ok(checked >= 15, `only ${checked} animated callbacks were inspected`);
});

test('the role screen greets with the waving mascot and the logo badge instead of the blue square', () => {
  const foundation = readSource('screens/foundation/index.tsx');
  assert.match(foundation, /<Mascot interactive pose="wave"/);
  assert.match(foundation, /logo-badge/);
  assert.match(foundation, /accessibilityLabel="손을 흔드는 마스코트"/);
  // Web only: the same hero is dropped from the tab order and the accessibility tree; native keeps the label above.
  assert.match(foundation, /<Mascot interactive pose="wave" size=\{136\} accessibilityLabel="손을 흔드는 마스코트" decorativeOnWeb \/>/);
  assert.match(foundation, /월계 마스코트/);
  assert.doesNotMatch(foundation, />masscom</);
  // Role cards keep the existing hand-off to the caller.
  assert.match(foundation, /onChooseRole\(nextRole\)/);
});

test('celebration and reward reveal use the chosen companion with a cheering fallback', () => {
  assert.match(readSource('gamification/celebration.tsx'), /<Companion art=\{companionArt\} celebrate/);
  assert.match(readSource('gamification/reward-reveal.tsx'), /<Companion art=\{companionArt\} celebrate/);
  assert.match(read('companion.tsx'), /<Mascot pose=\{celebrate \? 'cheer' : 'wave'\}/);
});

test('the account page can always be left: a back button sits on every state of the settings route', () => {
  const back = read('back-header.tsx');
  assert.match(back, /accessibilityLabel="뒤로"/);
  assert.match(back, /router\.canGoBack\(\)/);
  assert.match(back, /router\.replace\('\/'\)/);
  const route = readSource('app/(tabs)/settings.tsx');
  assert.match(route, /<BackHeader/);
  assert.match(route, /<AuthRequiredRoute header=\{header\} \/>/);
});

test('the account screen keeps deletion, logout and the development preview rules', () => {
  const settings = readSource('screens/account-settings/index.tsx');
  assert.match(settings, /deletionCapability\(credential, destructiveReauthentication\)/);
  assert.match(settings, /runSessionAction\('logout'\)/);
  // The development UI preview and the empty five-space tour were removed with their routes (Issue #412), so Settings no longer links them.
  assert.doesNotMatch(settings, /__DEV__|foundation-preview|showcase-tour/);
  assert.match(settings, /<FloatingCard/);
});
