import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('../app/', import.meta.url));

test('four primary routes keep the production root while the foundation preview stays separate', () => {
  for (const name of ['index', 'claim', 'collection', 'settings']) {
    assert.ok(existsSync(join(app, '(tabs)', name + '.tsx')), name);
    assert.equal(existsSync(join(app, name + '.tsx')), false, name);
  }
  assert.ok(existsSync(join(app, 'foundation-preview.tsx')), 'isolated UI preview route');
  assert.equal(existsSync(join(app, '(tabs)', 'explore.tsx')), false, 'no duplicate explore route');
  assert.ok(existsSync(join(app, 'open.tsx')), 'external app link route');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.match(root, /name="\(tabs\)"/);
  assert.match(root, /key=\{auth\.accountId\}/);
  assert.match(root, /<AuthenticatedRoot\s*\/>/);
});

test('floating tab bar shows explore, a raised claim stamp and collection; account moves to the header', () => {
  const layout = readFileSync(join(app, '(tabs)', '_layout.tsx'), 'utf8');
  for (const title of ['탐색', '방문 인증', '도감']) assert.ok(layout.includes(title), title);
  assert.match(layout, /name="settings"[\s\S]*?href: null/);
  assert.match(layout, /tabBar=\{\(props\) => <FloatingTabBar \{\.\.\.props\} \/>\}/);
  const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');
  assert.match(bar, /useMotionEnabled\(\)/);
  // The bar height steps up with text size (barHeightFor in tab-bar-style.ts, tested there) and labels stop at 1.5x.
  assert.match(bar, /barHeightFor\(fontScale\)/);
  assert.match(bar, /maxFontSizeMultiplier=\{1\.5\}/);
  assert.match(bar, /accessibilityRole="tab"/);
});

test('the floating bar skips hidden routes and steps aside for the keyboard', () => {
  const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');
  // expo-router turns `href: null` into a display:none tab item; the bar must not draw those routes.
  assert.match(bar, /display === 'none'/);
  assert.match(bar, /keyboardDidShow/);
  assert.match(bar, /navigation\.emit\(\{ type: 'tabPress'/);
  // Screens (including the sign-in and setup notices) size their bottom padding from the height the bar reports.
  assert.match(bar, /BottomTabBarHeightCallbackContext/);
  const clearance = readFileSync(fileURLToPath(new URL('./use-tab-bar-clearance.ts', import.meta.url)), 'utf8');
  assert.match(clearance, /useContext\(BottomTabBarHeightContext\)/);
});

test('every primary screen offers the account avatar', () => {
  // The header is the first thing inside each screen's scroll content, so the claim route no longer draws one itself.
  for (const screen of ['merchant-list', 'collection', 'claim-redeem']) {
    const source = readFileSync(fileURLToPath(new URL(`../screens/${screen}/index.tsx`, import.meta.url)), 'utf8');
    assert.match(source, /<AppHeader/, screen);
  }
});

test('the UI preview entry is development-only and cannot replace account tools', () => {
  const settings = readFileSync(fileURLToPath(new URL('../screens/account-settings/index.tsx', import.meta.url)), 'utf8');
  const preview = readFileSync(join(app, 'foundation-preview.tsx'), 'utf8');
  assert.match(settings, /__DEV__\s*\?\s*\(/);
  assert.match(settings, /href="\/foundation-preview"/);
  assert.match(preview, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(settings, /계정 삭제 안내/);
});

test('the role preview Link child does not pass a style array to Expo Router Slot', () => {
  const settings = readFileSync(join(app, '..', 'screens', 'account-settings', 'index.tsx'), 'utf8');
  const link = settings.match(/<Link href="\/foundation-preview" asChild>([\s\S]*?)<\/Link>/)?.[1];
  assert.ok(link, 'development preview Link');
  const pressable = link.match(/<Pressable\b[^>]*>/)?.[0];
  assert.ok(pressable, 'Link direct Pressable child');
  assert.doesNotMatch(pressable, /style=\{\s*\[/, 'Expo Router Slot rejects array-valued child styles');
});
