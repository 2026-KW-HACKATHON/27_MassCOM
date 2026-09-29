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

test('tapping a pin opens the sheet, scrolls the pin clear of it, and Android back closes the sheet first', () => {
  assert.match(screen, /revealScrollY\(/);
  assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(screen, /<PinSheet/);
  assert.match(sheet, /<FloatingCard/);
  assert.match(sheet, /accessibilityLiveRegion="polite"/);
});

test('the sheet offers the shop page and directions, and a demo shop gets the reason instead of a directions button', () => {
  assert.match(sheet, /label="자세히 보기"/);
  assert.match(sheet, /label="길찾기"/);
  assert.match(sheet, /pathname: '\/merchants\/\[merchantId\]'/);
  assert.match(sheet, /directionsTargets\(pin\)/);
  assert.match(sheet, /DEMO_NO_DIRECTIONS/);
  assert.match(sheet, /targets \? \(/);
  assert.match(sheet, /numberOfLines=\{2\}/);
});

test('the direction chooser lists Naver Maps, KakaoMap and cancel, and a failed open is told to the person', () => {
  assert.match(sheet, /Alert\.alert\(/);
  for (const text of ['네이버 지도', '카카오맵', '취소']) assert.ok(sheet.includes(`text: '${text}'`), text);
  assert.match(sheet, /style: 'cancel'/);
  assert.match(sheet, /openDirections\(targets, provider\)/);
  assert.match(sheet, /지도를 열지 못했어요/);
  // The app never reads a location, and the chooser says how the search is done.
  assert.match(sheet, /도로명 주소로 검색/);
  assert.doesNotMatch(sheet + screen + pin, /expo-location|requestForegroundPermissions/);
});

test('loading, error and empty states are StateScenes; stale stamp data is called out, not hidden', () => {
  assert.match(screen, /<StateScene kind="loading"/);
  assert.match(screen, /<StateScene kind="error"/);
  assert.match(screen, /<StateScene kind="empty" title="아직 지도에 올릴 가게가 없어요"/);
  assert.match(screen, /도장 상태를 불러오지 못했어요/);
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
  assert.match(read('./town-pins.ts'), /buildStampSlots\(/);
});
