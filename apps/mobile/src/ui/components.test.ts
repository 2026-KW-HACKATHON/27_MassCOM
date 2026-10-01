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
  const list = readSource('screens/merchant-list/index.tsx');
  // The longer chip text wrapped to two lines at 360dp.
  assert.match(list, /copy="내 탐험 여권 보기"/);
  assert.match(list, /copy="로그인하면 여권이 열려요"/);
  assert.doesNotMatch(list, /도감에서 내 도장 보기/);
  const collection = readSource('screens/collection/index.tsx');
  // #296 Option A: a compact passport strip now sits in the header as a child (replacing the self-closing tag).
  assert.match(collection, /<AppHeader title="도감" subtitle="가본 가게마다 도장이 찍혀요">/);
  // The passport hero under the header already says "나의 탐험 여권".
  assert.doesNotMatch(collection, /<AppHeader title="나의 탐험 여권"/);
});

test('the header keeps account tools one tap away, and says so under the avatar', () => {
  const header = read('app-header.tsx');
  assert.match(header, /href="\/settings"/);
  assert.match(header, /accessibilityLabel="내 정보"/);
  // A visible "내 정보" label on its own frosted pill sits under the avatar; the 48dp target is the Pressable around both.
  assert.match(header, /styles\.avatarLabelPill[\s\S]*?styles\.avatarLabel[^>]*>내 정보</);
});

test('at 150% text and up the header keeps the essentials: a capped title, no subtitle, a small hero', () => {
  const header = read('app-header.tsx');
  assert.match(header, /isLargeText\(fontScale\)/);
  assert.match(header, /maxFontSizeMultiplier=\{1\.6\}[^>]*>\{title\}/);
  assert.match(header, /subtitle && !large/);
  assert.match(readSource('screens/merchant-list/index.tsx'), /size=\{heroMascotSize\(fontScale, 120\)\}/);
  assert.match(readSource('screens/claim-redeem/index.tsx'), /size=\{heroMascotSize\(fontScale, 112\)\}/);
});

test('the claim hero tells people what to show or type', () => {
  const claim = readSource('screens/claim-redeem/index.tsx');
  assert.match(claim, /직원에게 내 QR을 보여주거나, 점주 코드를 입력해요/);
  assert.doesNotMatch(claim, /점주에게 받은 QR을 촬영하거나 1회 코드를 입력하세요/);
});

test('header titles sit on the frosted panel while the avatar stays outside it', () => {
  const header = read('app-header.tsx');
  // #298: an optional 친구 entry (showFriendsEntry) can sit between the panel and the account avatar.
  assert.match(header, /<View style=\{\[styles\.headerPanel[^\]]*\]\}>[\s\S]*?<\/View>[\s\S]*?<Link href="\/settings"/);
  const back = read('back-header.tsx');
  assert.match(back, /<View style=\{\[styles\.headerPanel[^\]]*\]\}>[\s\S]*?styles\.backTitle[\s\S]*?<\/View>/);
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
  const list = readSource('screens/merchant-list/index.tsx');
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
  assert.equal(controls, 8, 'explore, collection, merchant detail, recommendations, town map, friends, friend passport, shop');
});

test('the sky art is the top of the scroll content: the headers carry it and SkyBackdrop is only the page colour', () => {
  assert.doesNotMatch(read('sky-backdrop.tsx'), /skyTownHeader|<Image|<SkyArt/);
  assert.match(read('sky-art.tsx'), /skyTownHeader/);
  assert.match(read('app-header.tsx'), /<SkyArt \/>/);
  assert.match(read('back-header.tsx'), /<SkyArt compact \/>/);
  // The header renders inside the scroll view, before the content, so both scroll away together.
  assert.match(read('sky-scroll-view.tsx'), /<ScrollView[\s\S]*\{header\}[\s\S]*<\/ScrollView>/);
});

test('no tab screen, the settings page or a stack page pins its header outside the scroll content', () => {
  const screens = [
    'screens/merchant-list/index.tsx', 'screens/collection/index.tsx', 'screens/claim-redeem/index.tsx',
    'screens/account-settings/index.tsx', 'screens/merchant-detail/index.tsx', 'screens/recommendations/index.tsx',
    'screens/town-map/index.tsx', 'screens/friends/index.tsx', 'screens/friends/passport.tsx', 'screens/shop/index.tsx',
  ];
  for (const file of screens) {
    const source = readSource(file);
    // The scroll view's own header prop, the list's header component, or the first child of a plain ScrollView.
    assert.match(source, /header=\{|ListHeaderComponent=\{|<ScrollView[^>]*>\s*<BackHeader/, `${file} puts its header inside the scroll content`);
    assert.doesNotMatch(source, /<SkyBackdrop>\s*<(?:AppHeader|BackHeader)/, `${file} draws its header above the scroller`);
  }
  assert.match(readSource('screens/merchant-list/index.tsx'), /ListHeaderComponent=\{\s*<>\s*<AppHeader/);
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
  assert.ok((detail.match(/<BackHeader title="음식점 상세"/g) ?? []).length >= 2, 'detail page and its state frame');
  assert.match(readSource('screens/recommendations/index.tsx'), /<BackHeader title="다음 가게 추천"/);
  // A merchant with a picture uses it as the header's own background; one without gets the sky art and no empty banner block.
  assert.match(detail, /<BackHeader title="음식점 상세" art=\{hero\.source\} artNote=\{hero\.source \? artNote : undefined\} onArtError=\{hero\.onError\} \/>/);
  // A hero picture that fails to load is dropped for the sky art (the hook sits above the early returns).
  assert.match(detail, /const hero = useArtFallback\(art\?\.source\);/);
  // The owner's AI picture says so; the bundled showcase picture keeps its own note (D-048).
  assert.match(detail, /const artNote = art \? \(art\.fromServer \? '사장님이 고른 AI 그림' : '가상 점포 시연 그림'\) : undefined;/);
  assert.doesNotMatch(detail, /styles\.banner|<Image/);
  const back = read('back-header.tsx');
  assert.match(back, /art \? <StoreArt source=\{art\}/);
  assert.match(back, /<SkyArt compact \/>/);
});

test('signed-out and set-up states of the tab routes sit on the sky under their own header, not on a white sheet', () => {
  for (const [file, title] of [
    ['app/(tabs)/claim.tsx', '방문 인증'], ['app/(tabs)/collection.tsx', '도감'], ['app/(tabs)/index.tsx', '어디로 탐험할까요?'],
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

test('the explore header asks one short question that fits on one line', () => {
  const list = readSource('screens/merchant-list/index.tsx');
  assert.match(list, /title="어디로 탐험할까요\?"\s*\n\s*subtitle="안 가본 가게에 도장을 찍어요"/);
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

test('mascots are plain images unless asked to be interactive, and only standalone heroes are', () => {
  const mascot = read('mascot.tsx');
  assert.match(mascot, /interactive = false/);
  assert.match(mascot, /mascotAccessibility\(accessibilityLabel, interactive\)/);
  // Without `interactive` the mascot is a bare Animated.Image: no Pressable, no wiggle handler.
  assert.match(mascot, /if \(!interactive\) return <Animated\.Image \{\.\.\.picture\} \{\.\.\.a11y\} \/>;/);
  assert.match(mascot, /<Pressable onPress=\{wiggle\} \{\.\.\.a11y\}>/);
  // Heroes that stand on the sky wiggle; mascots inside cards and modals do not.
  assert.match(readSource('screens/merchant-list/index.tsx'), /<Mascot\s+interactive\b/);
  assert.match(readSource('screens/foundation/index.tsx'), /<Mascot interactive pose="wave"/);
  assert.match(readSource('screens/claim-redeem/index.tsx'), /<Mascot interactive pose="stamp"/);
  // Explore and claim heroes are decorative (no label, so no extra focus stop); only the role screen's wave is announced as a button.
  for (const file of ['screens/merchant-list/index.tsx', 'screens/claim-redeem/index.tsx']) {
    const hero = readSource(file).match(/<Mascot\s+interactive[\s\S]*?\/>/)?.[0];
    assert.ok(hero, `${file} hero mascot`);
    assert.doesNotMatch(hero, /accessibilityLabel/, `${file} hero mascot is decorative`);
  }
  assert.match(readSource('screens/foundation/index.tsx'), /<Mascot interactive pose="wave"[^>]*accessibilityLabel=/);
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
    ['screens/merchant-list/index.tsx', 'merchantCardLabel(merchant)', 'merchantCardHint()'],
    ['screens/recommendations/index.tsx', 'recommendationLabel(item)', 'recommendationHint()'],
  ] as const) {
    const source = readSource(file);
    assert.ok(source.includes(`accessibilityLabel={${label}}`), `${file} label`);
    assert.ok(source.includes(`accessibilityHint={${hint}}`), `${file} hint`);
  }
  assert.match(read('floating-card.tsx'), /accessibilityHint=\{accessibilityHint\}/);
});

test('the collection says 도장 for the passport page, not 스탬프', () => {
  const collection = readSource('screens/collection/index.tsx');
  assert.doesNotMatch(collection, /스탬프/);
  assert.equal((collection.match(/title="도장판"/g) ?? []).length, 4, 'error, loading, ready and empty sections');
  assert.match(collection, /note=\{`도장 \$\{stampSlots\.filter/);
});

test('the explore passport chip shows earned badges from the badge book when signed in, and no dot otherwise', () => {
  const list = readSource('screens/merchant-list/index.tsx');
  assert.match(list, /useBadgeBook\(badgeApi\)/);
  assert.match(list, /passportChipData\(/);
  assert.match(list, /createBadgeApiClient\(/);
  // The hook needs a credential, so it lives in a component that only renders when signed in.
  assert.match(list, /function SignedInPassportChip/);
  assert.match(list, /auth\.credential && auth\.accountId \? \(\s*<SignedInPassportChip/);
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
  assert.match(foundation, /월계 마스코트/);
  assert.doesNotMatch(foundation, />masscom</);
  // Role cards keep the existing hand-off to the caller.
  assert.match(foundation, /onChooseRole\(nextRole\)/);
});

test('celebration cheers with the mascot and the reward reveal shows the gift pose', () => {
  assert.match(readSource('gamification/celebration.tsx'), /pose="cheer"/);
  assert.match(readSource('gamification/reward-reveal.tsx'), /pose="gift"/);
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
  assert.match(settings, /__DEV__\s*\?\s*\(/);
  assert.match(settings, /<FloatingCard/);
});
