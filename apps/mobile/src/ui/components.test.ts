import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

test('every animated piece respects reduced motion', () => {
  for (const file of ['sky-backdrop.tsx', 'floating-card.tsx', 'bounce-button.tsx', 'mascot.tsx', 'stagger.tsx']) {
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

test('a pressable card lays out like a static one: layout props on the Pressable, visuals on the card', () => {
  const card = read('floating-card.tsx');
  assert.match(card, /splitCardStyle\(/);
  assert.match(card, /<Pressable[\s\S]*?style=\{outer\}/);
  assert.match(card, /styles\.card, inner/);
});

test('the header keeps account tools one tap away', () => {
  const header = read('app-header.tsx');
  assert.match(header, /href="\/settings"/);
  assert.match(header, /accessibilityLabel="내 정보"/);
});

test('header titles sit on the frosted panel while the avatar stays outside it', () => {
  const header = read('app-header.tsx');
  assert.match(header, /<View style=\{\[styles\.headerPanel[^\]]*\]\}>[\s\S]*?<\/View>\s*<Link href="\/settings"/);
  const back = read('back-header.tsx');
  assert.match(back, /<View style=\{\[styles\.headerPanel[^\]]*\]\}>[\s\S]*?styles\.backTitle[\s\S]*?<\/View>/);
});

test('the header art fades into the page colour over its last 15% in both schemes', () => {
  const backdrop = read('sky-backdrop.tsx');
  assert.match(backdrop, /SEAM_FRACTION = 0\.15/);
  assert.match(backdrop, /id="seam"/);
  // The seam overlay is drawn for every scheme: it must not live inside the dark-only branch.
  const seam = backdrop.indexOf('id="seam"');
  const dark = backdrop.indexOf('{dark ? (');
  const darkEnd = backdrop.indexOf(') : null}', dark);
  assert.ok(seam < dark || seam > darkEnd, 'seam overlay is inside the dark-only branch');
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
  assert.match(mascot, /mascotAccessibility\(accessibilityLabel\)/);
  // Without `interactive` the mascot is a bare Animated.Image: no Pressable, no wiggle handler.
  assert.match(mascot, /if \(!interactive\) return <Animated\.Image \{\.\.\.picture\} \{\.\.\.a11y\} \/>;/);
  assert.match(mascot, /<Pressable onPress=\{wiggle\} \{\.\.\.a11y\}>/);
  // Heroes that stand on the sky wiggle; mascots inside cards and modals do not.
  assert.match(readSource('screens/merchant-list/index.tsx'), /<Mascot\s+interactive\b/);
  assert.match(readSource('screens/foundation/index.tsx'), /<Mascot interactive pose="wave"/);
  assert.match(readSource('screens/claim-redeem/index.tsx'), /<Mascot interactive pose="stamp"/);
  assert.doesNotMatch(read('state-scene.tsx'), /interactive/);
  assert.doesNotMatch(readSource('gamification/celebration.tsx'), /<Mascot[^>]*interactive/);
  assert.doesNotMatch(readSource('gamification/reward-reveal.tsx'), /<Mascot[^>]*interactive/);
});


test('passport stamp page tilts each visited stamp by merchant and labels every slot', () => {
  const page = read('passport-stamp-page.tsx');
  assert.match(page, /stampTilt\(stamp\.merchantId\)/);
  assert.match(page, /accessibilityLabel=\{stamp\.visited \? `\$\{stamp\.name\} 도장 받음` : `\$\{stamp\.name\} 도장 아직 없음`\}/);
  assert.match(page, /world\.paper/);
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
  const files = [
    ...readdirSync(fileURLToPath(new URL('./', import.meta.url))).filter((name) => name.endsWith('.tsx')).map((name) => `./${name}`),
    '../navigation/floating-tab-bar.tsx',
    '../gamification/celebration.tsx',
    '../gamification/reward-reveal.tsx',
  ];
  let checked = 0;
  for (const file of files) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
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
  assert.ok(checked >= 12, `only ${checked} animated callbacks were inspected`);
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
  assert.match(route, /<AuthRequiredRoute \/>/);
});

test('the account screen keeps deletion, logout and the development preview rules', () => {
  const settings = readSource('screens/account-settings/index.tsx');
  assert.match(settings, /deletionCapability\(credential, destructiveReauthentication\)/);
  assert.match(settings, /runSessionAction\('logout'\)/);
  assert.match(settings, /__DEV__\s*\?\s*\(/);
  assert.match(settings, /<FloatingCard/);
});
