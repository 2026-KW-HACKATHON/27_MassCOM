import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../', import.meta.url));
const read = (relative: string) => readFileSync(join(src, relative), 'utf8');
const screen = read('screens/merchant-art/index.tsx');
const grid = read('screens/merchant-art/draft-grid.tsx');
const card = read('screens/merchant-art/entry-card.tsx');
const hook = read('merchant-art/use-merchant-art.ts');
const route = read('app/merchant-art.tsx');
const owner = read('screens/showcase-merchant/index.tsx');

function sourcesIn(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourcesIn(path) : /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test('the page says what it is once: the AI disclosure and the "takes 1-2 minutes, keeps going if you leave" note', () => {
  assert.match(screen, /export const AI_DISCLOSURE = 'AI로 만든 그림이에요\. 가게 이름과 메뉴 이름만 사용해요\.';/);
  assert.equal((screen.match(/AI_DISCLOSURE/g) ?? []).length, 2, 'declared once and drawn once');
  assert.match(screen, /export const GENERATING_NOTE = '1~2분 걸려요\. 화면을 떠나도 계속 만들어요\.';/);
  // The generating panel wears the mascot and reads its state politely.
  assert.match(screen, /<Mascot pose="search" size=\{132\} \/>/);
  assert.match(screen, /accessibilityLiveRegion="polite" style=\{styles\.generating\}/);
  assert.match(screen, /\{GENERATING_NOTE\}/);
});

test('current art, remaining counts and the start button sit on the first card', () => {
  assert.match(screen, /<CurrentArt owner=\{owner\}/);
  assert.match(screen, /quotaSummary\(owner\.quota\)/);
  assert.match(screen, /label=\{busy === 'start' \? busyLabels\.start : 'AI 시안 받기'\}/);
  assert.match(screen, /disabled=\{working \|\| !canStartDrafts\(owner\)\}/);
  // The picture is asked of the art bridge, so it is the customers' picture, and the default is written out when there is none.
  assert.match(screen, /merchantArt\(\{ id: merchantId, artUrl: owner\.current\?\.artUrl \}, apiUrl\)/);
  assert.match(screen, /글자 도장/);
});

test('choosing, using and resetting a picture each ask first with an alert, and the buttons only open the alert', () => {
  for (const [confirm, title, label] of [
    ['confirmChoose', '이 시안으로 고급 그림을 만들까요?', '이 시안으로 고급 그림 만들기'],
    ['confirmApply', '이 그림을 가게 그림으로 쓸까요?', '가게 그림으로 쓰기'],
    ['confirmReset', '기본 그림으로 되돌릴까요?', '기본 그림으로 되돌리기'],
  ] as const) {
    const body = screen.match(new RegExp(`const ${confirm} = \\(\\) => \\{[\\s\\S]*?\\n  \\};`))?.[0] ?? '';
    assert.ok(body.includes(`Alert.alert(`), `${confirm} asks`);
    assert.ok(body.includes(title), `${confirm} title`);
    assert.match(body, /\{ text: '취소', style: 'cancel' \}/, `${confirm} can be cancelled`);
    assert.ok(screen.includes(`'${label}'`), `${label} button`);
    assert.match(screen, new RegExp(`onPress=\\{${confirm}\\}`), `${label} opens ${confirm}`);
  }
  // Nothing calls the server steps except through an alert button (or the first "AI 시안 받기", which asks for nothing).
  assert.doesNotMatch(screen, /onPress=\{\(\) => void art\.(chooseDraft|applyRound|resetArt)/);
  assert.match(screen, /style: 'destructive', onPress: \(\) => void art\.resetArt\(\)/);
});

test('a new set of drafts also asks first, because it throws away the ones on screen', () => {
  const body = screen.match(/const confirmNewDrafts = \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(body, /Alert\.alert\(/);
  assert.equal((screen.match(/onPress=\{confirmNewDrafts\}/g) ?? []).length, 2, 'the drafts and the final panel');
  assert.equal((screen.match(/label=\{busy === 'start' \? busyLabels\.start : '새 시안 받기'\}/g) ?? []).length, 2);
});

test('the drafts are a 2x2 grid of radio buttons that read their number and style and show a chosen state', () => {
  assert.match(grid, /accessibilityRole="radiogroup"/);
  assert.match(grid, /accessibilityRole="radio"/);
  assert.match(grid, /accessibilityLabel=\{draftAccessibilityLabel\(draft\)\}/);
  assert.match(grid, /accessibilityState=\{\{ selected, disabled \}\}/);
  // The style name is text, and a chosen draft also says so in words next to its border and check.
  assert.match(grid, /\{selected \? `\$\{draft\.label\} · 선택됨` : draft\.label\}/);
  assert.match(grid, /<CheckGlyph color=\{palette\.onPrimary\} \/>/);
  assert.match(grid, /styles\.tileSelected/);
  assert.match(grid, /textBreakStrategy="simple"/);
  assert.match(grid, /accessible=\{false\}[\s\S]*?resizeMode="cover"/, 'the picture itself is not a second stop');
  assert.match(screen, /<DraftGrid drafts=\{round\.drafts\} size=\{draftTileSize\(width\)\}/);
});

test('reduced motion is honoured: the chosen draft only grows when motion is on, and the shared pieces already follow the setting', () => {
  assert.match(grid, /useMotionEnabled\(\)/);
  assert.match(grid, /scale\.set\(enabled \? withSpring\(selected \? 1\.03 : 1, motion\.spring\) : 1\)/);
  for (const shared of ['bounce-button.tsx', 'mascot.tsx', 'stagger.tsx']) assert.match(read(`ui/${shared}`), /useMotionEnabled\(\)/, shared);
  assert.match(screen, /<Stagger index=\{0\}>/);
});

test('the final picture is large, labelled as an AI picture, and applying it is its own button', () => {
  assert.match(screen, /accessibilityLabel="AI로 만든 고급 그림 미리보기"/);
  assert.match(screen, /finalArtSize\(width\)/);
  assert.match(screen, /label=\{busy === 'apply' \? busyLabels\.apply : '가게 그림으로 쓰기'\}/);
});

test('every failure is shown as plain Korean through the message table, never as a raw code', () => {
  assert.match(screen, /artCodeMessage\(round\?\.failureCode\)/);
  assert.match(screen, /artCodeMessage\('AI_ART_NOT_CONFIGURED'\)/);
  assert.match(screen, /artCodeMessage\('AI_ART_DAILY_LIMIT'\)/);
  assert.match(hook, /ownerArtErrorMessage\(error\)/);
  assert.match(hook, /pollFailureMessage\(error\)/);
  assert.doesNotMatch(screen, /error\.code|\{round\??\.failureCode\}/);
  // A message the owner can dismiss is announced politely.
  assert.match(screen, /accessibilityLiveRegion="polite"\s+onPress=\{art\.dismissNotice\}/);
});

test('polling is only asked for the round the model names, stops when the screen is left, and starts fresh when it returns', () => {
  assert.match(hook, /const target = pollTarget\(state, active\);/);
  assert.match(hook, /const active = focused && foreground;/);
  assert.match(hook, /createRoundPoller\(\{/);
  assert.match(hook, /poller\.start\(\);\s+return \(\) => poller\.stop\(\);/);
  assert.match(hook, /AppState\.addEventListener\('change'/);
  assert.match(hook, /if \(active && !wasActive\.current\) void refresh\(\);/);
  // Nothing dispatches into an unmounted screen, and a reload that began before an owner step cannot overwrite it.
  assert.ok((hook.match(/alive\.current/g) ?? []).length >= 8);
  assert.match(hook, /epoch\.current === at/);
  assert.match(hook, /if \(inFlight\.current\) return;/);
});

test('a step the server had moved past, or a reply the app could not read, reloads the page', () => {
  assert.match(hook, /if \(needsArtReload\(error\)\) void load\(ownerArtErrorMessage\(error\)\);/);
  assert.match(hook, /error\.code === 'AI_ART_ROUND_NOT_FOUND'/);
});

test('the page is a stack route for the showcase app only, registered without the native header', () => {
  assert.match(read('app/_layout.tsx'), /<Stack\.Screen name="merchant-art" options=\{\{ headerShown: false \}\} \/>/);
  assert.match(route, /canOpenMerchantArtRoute\(Application\.applicationId\)/);
  assert.match(route, /useFocusEffect\(useCallback\(\(\) => \{\s+setFocused\(true\);\s+return \(\) => setFocused\(false\);/);
  assert.match(route, /focused=\{focused\}/);
  assert.match(route, /useLocalSearchParams<\{ merchantId\?: string \}>\(\)/);
  assert.match(route, /if \(!auth\.credential \|\| !auth\.accountId\)/);
});

test('the showcase owner page opens it in place, only for the merchant the probe allowed, and back returns to the owner page', () => {
  assert.match(owner, /artOpen && state\.status === 'allowed' && apiUrl/);
  assert.match(owner, /merchantId=\{state\.merchantId\}/);
  assert.match(owner, /onBack=\{\(\) => setArtOpen\(false\)\}/);
  assert.match(owner, /if \(artOpen\) setArtOpen\(false\);\s+else onBrowse\(\);/);
  assert.match(owner, /topSlot=\{<MerchantArtEntryCard apiUrl=\{apiUrl\} merchantId=\{state\.merchantId\} artUrl=\{state\.artUrl\} onPress=\{\(\) => setArtOpen\(true\)\} \/>\}/);
  assert.match(read('screens/merchant-claim/staff.tsx'), /\{topSlot\}\s+<View style=\{styles\.formCard\}>/);
  assert.match(card, /accessibilityLabel="가게 그림 만들기"/);
  assert.match(card, /merchantArt\(\{ id: merchantId, artUrl \}, apiUrl\)/);
});

test('the back button leaves an inline page through onBack instead of the router', () => {
  const back = read('ui/back-header.tsx');
  assert.match(back, /onBack\?: \(\) => void;/);
  assert.match(back, /onPress=\{onBack \?\? \(\(\) => \(router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/'\)\)\)\}/);
  assert.match(screen, /<BackHeader title="가게 그림 만들기" onBack=\{onBack\} \/>/);
});

test('the owner art code never trips the release wallet check: no bare open( call, and no wallet or payment word', () => {
  const files = [...sourcesIn(join(src, 'merchant-art')), ...sourcesIn(join(src, 'screens/merchant-art')), join(src, 'app/merchant-art.tsx')];
  assert.ok(files.length >= 8);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\bopen\(/, file);
    assert.doesNotMatch(text, /@reown|AppKit|useAppKit|approve\(|permit\(/, file);
  }
});

test('the art code adds no dependency and no bundled picture', () => {
  for (const file of [...sourcesIn(join(src, 'merchant-art')), ...sourcesIn(join(src, 'screens/merchant-art'))]) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /require\(/, file);
    for (const [, specifier] of text.matchAll(/from '([^']+)'/g)) {
      assert.match(specifier!, /^(\.|@\/|react|react-native|react-native-reanimated|react-native-safe-area-context|react-native-svg|expo-router)/, `${file}: ${specifier}`);
    }
  }
});
