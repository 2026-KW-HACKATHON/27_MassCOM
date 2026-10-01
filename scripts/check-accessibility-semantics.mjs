#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const sourceRoot = resolve(process.argv[2] ?? 'apps/mobile/src');
const requiredLiveRegions = [
  'screens/auth-required/index.tsx',
  'screens/claim-redeem/index.tsx',
  'screens/collection/index.tsx',
  'screens/recommendations/index.tsx',
  'screens/wallet-link/index.tsx',
  'screens/account-settings/index.tsx',
  'screens/consent/index.tsx',
];
let failures = 0;
const sources = [];
for (const relativePath of requiredLiveRegions) {
  let source = '';
  try {
    source = readFileSync(join(sourceRoot, relativePath), 'utf8');
  } catch {
    console.error(`missing dynamic status screen: ${relativePath}`);
    failures += 1;
    continue;
  }
  sources.push(source);
  if (!source.includes('accessibilityLiveRegion="polite"')) {
    console.error(`missing polite live region: ${relativePath}`);
    failures += 1;
  }
}

// Screen copy that moved into pure builders (e.g. the passport stamp labels) still counts as user-facing text.
const copySources = ['screens/collection/collection-stamps.ts', 'screens/collection/collectible-browser.tsx'];
for (const relativePath of copySources) {
  sources.push(readFileSync(join(sourceRoot, relativePath), 'utf8'));
}
const corpus = sources.join('\n');
for (const term of ['음식점', '캠페인', '방문 수령', '앱 수집품', '외부 지갑 주소 확인', 'NFT 등록']) {
  if (!corpus.includes(term)) {
    console.error(`missing user-facing accessibility term: ${term}`);
    failures += 1;
  }
}
if (/점포 ID|binding ID|job ID/.test(corpus)) {
  console.error('internal ID is used as primary screen copy');
  failures += 1;
}
const claimScreen = sources[1] ?? '';
if (!/accessibilityLabel="QR 코드 촬영"/.test(claimScreen)
  || !/accessibilityHint="점주 화면의 방문 수령 QR 코드를 카메라로 읽습니다\."/.test(claimScreen)) {
  console.error('QR camera action is missing its TalkBack label or hint');
  failures += 1;
}
// 동의 화면(Issue #253): 체크박스는 스크린리더가 역할과 선택 여부를 읽어야 하고, 링크·머리글·비활성 버튼도 의미가 있어야 한다.
const consentScreen = sources[requiredLiveRegions.indexOf('screens/consent/index.tsx')] ?? '';
for (const [pattern, what] of [
  [/accessibilityRole="checkbox"/, 'checkbox role'],
  [/accessibilityState=\{\{ checked/, 'checked state'],
  [/accessibilityRole="link"/, 'link role'],
  [/accessibilityRole="header"/, 'header role'],
  [/accessibilityState=\{\{ disabled: !ready \|\| busy/, 'disabled state of the submit button'],
]) {
  if (!pattern.test(consentScreen)) {
    console.error(`consent screen is missing its ${what}`);
    failures += 1;
  }
}
if (/allowFontScaling=\{false\}|maxFontSizeMultiplier/.test(consentScreen)) {
  console.error('consent screen must let text scale to 200%');
  failures += 1;
}
if (failures > 0) process.exit(1);
console.log('mobile accessibility semantics verified');
