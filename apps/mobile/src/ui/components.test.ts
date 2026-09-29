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

test('the header keeps account tools one tap away', () => {
  const header = read('app-header.tsx');
  assert.match(header, /href="\/settings"/);
  assert.match(header, /accessibilityLabel="내 정보"/);
});

test('state scenes map to the right mascot', () => {
  const scene = read('state-scene.tsx');
  assert.match(scene, /empty: 'sleep'/);
  assert.match(scene, /error: 'puzzled'/);
  assert.match(scene, /loading: 'search'/);
});

test('decorative mascots are hidden from screen readers unless labelled', () => {
  const mascot = read('mascot.tsx');
  assert.match(mascot, /importantForAccessibility=\{accessibilityLabel \? 'yes' : 'no-hide-descendants'\}/);
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
  assert.match(foundation, /<Mascot pose="wave"/);
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
