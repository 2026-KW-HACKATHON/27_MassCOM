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
if (failures > 0) process.exit(1);
console.log('mobile accessibility semantics verified');
