import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));

test('the primary route files keep the production root; the dev preview, tour and duplicate shop route are gone', () => {
  // Five visible tab slots: 탐색 · 도감 · 홈 · 놀이 · 상점. Other routes retain their deep links.
  for (const name of ['shop', 'collection', 'index', 'search', 'play-tab', 'map', 'claim', 'friends', 'settings']) {
    assert.ok(existsSync(join(app, '(tabs)', name + '.tsx')), name);
    assert.equal(existsSync(join(app, name + '.tsx')), false, name);
  }
  // Issue #412: shop-again no longer renders a second shop; it only redirects, so old links keep working. The two preview routes were
  // development and showcase-only duplicates and are gone.
  const shopAgain = readFileSync(join(app, '(tabs)', 'shop-again.tsx'), 'utf8');
  assert.match(shopAgain, /return <Redirect href="\/shop" \/>;/);
  assert.doesNotMatch(shopAgain, /ShopScreen|from '\.\/shop'/, 'a redirect, not a second shop');
  assert.equal(existsSync(join(app, 'foundation-preview.tsx')), false, 'no development UI preview route');
  assert.equal(existsSync(join(app, 'showcase-tour.tsx')), false, 'no empty five-space tour route');
  assert.equal(existsSync(join(app, '(tabs)', 'explore.tsx')), false, 'no duplicate explore route');
  assert.ok(existsSync(join(app, 'open.tsx')), 'external app link route');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.match(root, /name="\(tabs\)"/);
  assert.match(root, /key=\{auth\.accountId\}/);
  assert.match(root, /<AuthenticatedRoot\s*\/>/);
});

test('floating tab bar shows explore, collection, a raised home, play and shop', () => {
  const layout = readFileSync(join(app, '(tabs)', '_layout.tsx'), 'utf8');
  for (const title of ['홈', '탐색', '도감', '놀이', '상점']) assert.ok(layout.includes(title), title);
  assert.match(layout, /name="shop" options=\{\{ title: '상점', tabBarAccessibilityLabel: '상점' \}\}/);
  assert.doesNotMatch(layout, /name="shop"[^\n]*href: null/, 'the shop tab is visible');
  // The redirect route stays out of the tab bar.
  assert.match(layout, /name="shop-again" options=\{\{ title: '상점', href: null \}\}/);
  assert.match(layout, /name="play-tab" options=\{\{ title: '놀이', tabBarAccessibilityLabel: '놀이' \}\}/);
  assert.match(layout, /name="map" options=\{\{ title: '지도', href: null \}\}/);
  assert.match(layout, /name="claim" options=\{\{ title: '방문 인증', href: null \}\}/);
  assert.match(layout, /name="friends" options=\{\{ title: '친구', href: null \}\}/);
  assert.match(layout, /name="settings"[\s\S]*?href: null/);
  // The raised home remains the middle of five visible slots.
  const order = ['search', 'collection', 'index', 'play-tab', 'shop'].map((name) => layout.indexOf(`name="${name}"`));
  assert.ok(order.every((position) => position >= 0), 'every route is declared');
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'declared in bar order');
  assert.match(layout, /initialRouteName="index"/);
  assert.match(layout, /tabBar=\{\(props\) => <FloatingTabBar \{\.\.\.props\} \/>\}/);
  const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');
  assert.match(bar, /useMotionEnabled\(\)/);
  // The bar height steps up with text size (barHeightFor in tab-bar-style.ts, tested there) and labels stop at 1.5x.
  assert.match(bar, /barHeightFor\(fontScale\)/);
  assert.match(bar, /maxFontSizeMultiplier=\{1\.5\}/);
  assert.match(bar, /accessibilityRole="tab"/);
  // Every visible tab has its own glyph; an unmapped route would silently show the explore magnifier.
  assert.match(bar, /index: 'home'/);
  assert.match(bar, /search: 'map'/);
  assert.match(bar, /'play-tab': 'play'/);
  assert.match(bar, /shop: 'shop'/);
  assert.doesNotMatch(bar, /shop-again/);
  assert.match(bar, /route\.name === 'index'/);
});

test('the floating bar skips hidden routes and steps aside for the keyboard', () => {
  const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');
  // expo-router turns `href: null` into a display:none tab item; the bar must not draw those routes.
  assert.match(bar, /display === 'none'/);
  assert.match(bar, /keyboardDidShow/);
  assert.match(bar, /runningGame = Boolean\(\(state\.routes\[state\.index\]\?\.params/);
  assert.match(bar, /away = keyboardShown \|\| runningGame \|\| !visible\.some/);
  assert.match(bar, /navigation\.emit\(\{ type: 'tabPress'/);
  // Screens (including the sign-in and setup notices) size their bottom padding from the height the bar reports.
  assert.match(bar, /BottomTabBarHeightCallbackContext/);
  const clearance = readFileSync(fileURLToPath(new URL('./use-tab-bar-clearance.ts', import.meta.url)), 'utf8');
  assert.match(clearance, /useContext\(BottomTabBarHeightContext\)/);
});

test('claim route forwards a single selected merchant ID to the redeem screen', () => {
  const claim = readFileSync(join(app, '(tabs)', 'claim.tsx'), 'utf8');
  assert.match(claim, /typeof params\.merchantId === 'string' \? params\.merchantId : undefined/);
  assert.match(claim, /selectedMerchantId=\{selectedMerchantId\}/);
  const screen = readFileSync(fileURLToPath(new URL('../screens/claim-redeem/index.tsx', import.meta.url)), 'utf8');
  assert.match(screen, /selectedMerchantMismatch\(selectedMerchantId, preview\)/);
});

test('auth transitions clear only the prior account pending claim', () => {
  const auth = readFileSync(fileURLToPath(new URL('../auth/auth-provider.tsx', import.meta.url)), 'utf8');
  assert.match(auth, /if \(accountId\) await clearClaimPendingIntent\(platformSecureStore, accountId\)/);
  assert.equal((auth.match(/if \(previousAccountId\) await clearClaimPendingIntent\(platformSecureStore, previousAccountId\)/g) ?? []).length, 3);
});

test('every primary screen offers the account avatar', () => {
  // The header is the first thing inside each screen's scroll content, so the claim route no longer draws one itself.
  for (const screen of ['home', 'real-map', 'collection', 'claim-redeem', 'shop']) {
    const source = readFileSync(fileURLToPath(new URL(`../screens/${screen}/index.tsx`, import.meta.url)), 'utf8');
    assert.match(source, /<AppHeader/, screen);
  }
});

test('Settings and the root stack no longer carry the removed preview routes, and account tools stay', () => {
  const settings = readFileSync(fileURLToPath(new URL('../screens/account-settings/index.tsx', import.meta.url)), 'utf8');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.doesNotMatch(settings, /foundation-preview|showcase-tour|canOpenShowcaseTour/);
  assert.doesNotMatch(root, /foundation-preview|showcase-tour/);
  assert.match(settings, /계정 삭제 안내/);
});

test('the home quick action Link children do not pass style arrays to Expo Router Slot', () => {
  const home = readFileSync(join(app, '..', 'screens', 'home', 'index.tsx'), 'utf8');
  assert.match(home, /<AppHeader[^>]*showFriendsEntry/, 'friends stay available from the home header');
  for (const href of ['/claim', '/home/missions', '/home/exhibit']) {
    const link = home.match(new RegExp(`<Link href="${href}" asChild>([\\s\\S]*?)<\\/Link>`))?.[1];
    assert.ok(link, `${href} quick action Link`);
    const pressable = link.match(/<Pressable\b[^>]*>/)?.[0];
    assert.ok(pressable, `${href} Link direct Pressable child`);
    assert.match(pressable, /StyleSheet\.flatten\(/, `${href} child flattens style before Expo Router Slot`);
    assert.doesNotMatch(pressable, /style=\{\s*\[/, 'Expo Router Slot rejects array-valued child styles');
  }
  const nextActionLink = home.match(/nextAction \? (<Link[\s\S]*?<\/Link>)/)?.[1];
  assert.ok(nextActionLink, 'the prioritized home action is a Link');
  const nextActionPressable = nextActionLink.match(/asChild><Pressable\b[^>]*>/)?.[0];
  assert.ok(nextActionPressable, 'the prioritized action has a direct Pressable child');
  assert.match(nextActionPressable, /style=\{\{/, 'the prioritized action passes a plain style object');
  assert.doesNotMatch(nextActionPressable, /style=\{\s*\[/, 'Expo Router Slot rejects array-valued child styles');
});
