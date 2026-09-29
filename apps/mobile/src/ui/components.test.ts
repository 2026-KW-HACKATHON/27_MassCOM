import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
