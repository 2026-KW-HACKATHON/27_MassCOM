import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const screen = read('./index.tsx');
const pin = read('./town-pin.tsx');
const sheet = read('./pin-sheet.tsx');
const route = read('../../app/(tabs)/map.tsx');

/** Every `name( ... )` call in a source, balanced by parentheses, so a hook's whole body can be inspected on its own. */
function callBodies(source: string, name: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf(`${name}(`, from);
    if (at < 0) return bodies;
    let depth = 0;
    let end = at + name.length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')' && (depth -= 1) === 0) break;
    }
    bodies.push(source.slice(at, end + 1));
    from = end;
  }
}

test('the map route wears the standard sky header with the illustration disclosure, once', () => {
  assert.match(route, /<AppHeader title=\{TOWN_MAP_TITLE\} subtitle=\{TOWN_MAP_DISCLOSURE\} \/>/);
  assert.match(screen, /<AppHeader title=\{TOWN_MAP_TITLE\} subtitle=\{TOWN_MAP_DISCLOSURE\} \/>/);
  // The header drops its subtitle at 150% text; the same sentence then sits above the map instead.
  assert.match(screen, /isLargeText\(fontScale\)/);
  assert.equal((screen.match(/TOWN_MAP_DISCLOSURE/g) ?? []).length >= 2, true);
});

test('the map screen sits on the sky like the other tabs: scrim, header in the scroll content, tab bar clearance', () => {
  assert.match(screen, /<SkyBackdrop>/);
  assert.match(screen, /<SkyScrollView/);
  assert.match(screen, /useTabBarClearance\(\)/);
  assert.match(screen, /progressViewOffset=\{insets\.top\}/);
  assert.match(route, /useAuthSession\(\)/);
  assert.match(route, /key=\{auth\.accountId\}/);
});

test('the picture is the approved town map, scaled to the map width and never announced as an image', () => {
  assert.match(screen, /townMapArt/);
  assert.match(screen, /accessibilityIgnoresInvertColors/);
  assert.match(screen, /mapHeightFor\(mapWidth\)/);
  assert.match(read('../../ui/mascot-art.ts'), /export const townMapArt: number = require\('\.\.\/\.\.\/assets\/images\/mascot\/v2\/town-map\.png'\)/);
});

test('a pin says its shop and stamp state, is a 48dp button and shows a shop illustration only through the art bridge', () => {
  assert.match(pin, /accessibilityRole="button"/);
  assert.match(pin, /accessibilityLabel=\{pin\.label\}/);
  assert.match(pin, /accessibilityState=\{\{ selected \}\}/);
  assert.match(pin, /merchantArtSource\(pin\.merchantId\)/);
  assert.match(pin, /pin\.status === 'visited'/);
  assert.match(pin, /styles\.pinDiscVisited/);
  assert.match(pin, /styles\.pinDiscNone/);
  assert.match(pin, /styles\.pinCheck/);
  assert.match(pin, /pin\.glyph/);
});

test('showcase art reaches the map only through merchant-art, never as a direct import', () => {
  const src = fileURLToPath(new URL('../../', import.meta.url));
  const files = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
  for (const file of files(join(src, 'screens', 'town-map'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /collectibles\/showcase-/, file);
    assert.doesNotMatch(source, /showcase-collectible-art-assets/, file);
  }
});

test('motion: press and entrance follow the reduced-motion setting, and scrolling to a pin is not animated when it is on', () => {
  for (const source of [pin, sheet]) assert.match(source, /useMotionEnabled\(\)/);
  assert.match(screen, /useMotionEnabled\(\)/);
  assert.match(screen, /animated: enabled/);
  // A pressed pin shows a fill change too, so the press is visible without any motion.
  assert.match(pin, /pressed \? styles\.pinDiscPressed : null/);
});

test('tapping a pin opens the sheet and the pin is scrolled clear of it', () => {
  assert.match(screen, /<PinSheet/);
  assert.match(sheet, /<FloatingCard/);
  assert.match(sheet, /accessibilityLiveRegion="polite"/);
  // The pin is only queued when it is tapped ...
  const select = screen.match(/const select = [\s\S]*?\n  \};/)?.[0] ?? '';
  assert.ok(select.length > 0, 'found select');
  assert.match(select, /setReveal\(\{/);
  assert.doesNotMatch(select, /scrollTo\(|revealScrollY\(/, 'scrolling before the sheet padding exists stops at the old end of the page');
  // ... and scrolled once the sheet has been laid out for that very shop, using the height that was measured.
  const reveal = callBodies(screen, 'useEffect').find((effect) => effect.includes('revealScrollY('));
  assert.ok(reveal, 'an effect does the scrolling');
  assert.match(reveal, /sheetMeasure\?\.id !== reveal\.id/);
  assert.match(reveal, /coverHeight: sheetBottom \+ sheetMeasure\.height/);
  assert.match(reveal, /contentHeight:/);
  assert.match(reveal, /requestAnimationFrame\(/);
  assert.match(screen, /onContentSizeChange=/);
  assert.match(screen, /onMeasure=\{\(height\) => setSheetMeasure\(\{ id: selected\.merchantId, height \}\)\}/);
  // A keyed sheet is laid out afresh for every shop, so a card as tall as the last still reports itself.
  assert.match(screen, /<PinSheet[^>]*key=\{selected\.merchantId\}/);
  assert.doesNotMatch(screen, /SHEET_ESTIMATE/);
});

test('Android back closes the sheet only while the map is the focused screen, and never from a plain effect', () => {
  assert.match(screen, /import \{ useFocusEffect \} from 'expo-router'/);
  const focusEffects = callBodies(screen, 'useFocusEffect');
  const back = focusEffects.filter((effect) => effect.includes("BackHandler.addEventListener('hardwareBackPress'"));
  assert.equal(back.length, 1, 'exactly one registration, inside useFocusEffect');
  assert.match(back[0]!, /subscription\.remove\(\)/);
  assert.match(back[0]!, /if \(!sheetOpen\) return;/);
  assert.equal((screen.match(/BackHandler\.addEventListener/g) ?? []).length, 1);
  for (const effect of callBodies(screen, 'useEffect')) assert.doesNotMatch(effect, /BackHandler/, 'a plain effect stays registered on other tabs');
});

test('screen reader focus moves to the shop name when a card opens, and back to the pin that opened it when it closes', () => {
  assert.match(sheet, /const title = useRef<Text>\(null\)/);
  assert.match(sheet, /<Text ref=\{title\} accessibilityRole="header"/);
  const focus = callBodies(sheet, 'useEffect').find((effect) => effect.includes('sendAccessibilityEvent'));
  assert.ok(focus, 'the sheet moves focus');
  assert.match(focus, /sendAccessibilityEvent\(title\.current, 'focus'\)/);
  assert.match(focus, /setTimeout\(/);
  assert.match(focus, /clearTimeout\(/);
  assert.match(focus, /\[pin\.merchantId\]/);
  // Closing (button and Android back alike) remembers the opener and focuses it once the card is gone.
  assert.match(screen, /returnFocusTo\.current = selectedId/);
  assert.match(screen, /onClose=\{closeSheet\}/);
  const back = callBodies(screen, 'useEffect').find((effect) => effect.includes('returnFocusTo.current'));
  assert.ok(back, 'an effect hands focus back');
  assert.match(back, /selectedId !== undefined/);
  assert.match(back, /sendAccessibilityEvent\(opener, 'focus'\)/);
  assert.match(screen, /pressableRef=\{openerRef\(pin\.merchantId\)\}/);
  assert.match(screen, /ref=\{openerRef\(item\.merchantId\)\}/);
  assert.match(pin, /ref=\{pressableRef\}/);
});

test('the sheet offers the shop page and directions, and a demo shop gets the reason instead of a directions button', () => {
  assert.match(sheet, /label="자세히 보기"/);
  assert.match(sheet, /label="길찾기"/);
  assert.match(sheet, /pathname: '\/merchants\/\[merchantId\]'/);
  assert.match(sheet, /directionsTargets\(pin\)/);
  // Why there is no button (virtual demo place, or no address to search) is a sentence from directionsNotice, not a silent gap.
  assert.match(sheet, /directionsNotice\(pin\)/);
  assert.match(sheet, /\{notice \? <Text style=\{styles\.sheetNotice\}>\{notice\}<\/Text> : null\}/);
  assert.match(sheet, /targets \? \(/);
  assert.match(sheet, /numberOfLines=\{2\}/);
});

test('the direction chooser lists Naver Maps, KakaoMap and cancel, and a failed open is told to the person', () => {
  assert.match(sheet, /Alert\.alert\(/);
  // The buttons and their Android-friendly order (취소 · 카카오맵 · 네이버 지도) come from directionsChooserButtons, tested in directions.test.ts.
  assert.match(sheet, /directionsChooserButtons\(\(provider\) => void go\(provider\)\)/);
  assert.doesNotMatch(sheet, /text: '/);
  assert.match(sheet, /openDirections\(targets, provider\)/);
  assert.match(sheet, /지도를 열지 못했어요/);
  // The app never reads a location, and the chooser says how the search is done.
  assert.match(sheet, /도로명 주소만 넘기고, 이 앱은 내 위치를 읽지 않아요/);
  assert.doesNotMatch(sheet + screen + pin, /expo-location|requestForegroundPermissions/);
});

test('loading, error and empty states are StateScenes; stale stamp data is called out, not hidden', () => {
  assert.match(screen, /<StateScene kind="loading"/);
  assert.match(screen, /<StateScene kind="error"/);
  assert.match(screen, /<StateScene kind="empty" title="아직 지도에 올릴 가게가 없어요"/);
  assert.match(screen, /도장 상태를 불러오지 못했어요/);
  // A failed refresh over stamps already shown says so and offers the retry.
  assert.match(screen, /\{stamps\.stale \? \(/);
  assert.match(screen, /도장 상태가 최신이 아닐 수 있어요 · 다시 불러오기/);
  // The sheet copy tells a signed-out person to log in instead of claiming a failed check.
  assert.match(screen, /\{ signedOut, loading: stamps\.status === 'loading' \}\)/);
});

test('shops beyond the eight buildings are listed below the map and open the same sheet', () => {
  assert.match(screen, /지도에 다 담지 못한 가게/);
  assert.match(screen, /overflow\.map\(/);
  assert.match(screen, /accessibilityLabel=\{item\.label\}/);
});

test('the map reads the same public list and the same collection stamp model as the passport, with no new API', () => {
  assert.match(screen, /useMerchantCatalog\(apiUrl\)/);
  assert.match(screen, /buildTownPins\(/);
  const hook = read('./use-town-collection.ts');
  assert.match(hook, /createCommerceApiClient\(/);
  assert.match(hook, /\.getCollection\(\)/);
  // Loads are started from one place (focus, first focus included), so a changed client never fetches twice; states follow the reducer.
  assert.match(hook, /useReducer\(townCollectionReducer, INITIAL_TOWN_COLLECTION\)/);
  assert.equal(callBodies(hook, 'useFocusEffect').length, 1);
  assert.equal(callBodies(hook, 'useEffect').length, 0);
  assert.doesNotMatch(hook, /firstFocus/);
  assert.match(read('./town-pins.ts'), /buildStampSlots\(/);
});
