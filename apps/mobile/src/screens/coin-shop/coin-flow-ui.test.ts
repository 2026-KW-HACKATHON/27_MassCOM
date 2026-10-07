import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const shop = readFileSync(fileURLToPath(new URL('./index.tsx', import.meta.url)), 'utf8');
const collection = readFileSync(fileURLToPath(new URL('../coin-collection/index.tsx', import.meta.url)), 'utf8');

test('a received ticket discloses its own merchant and exact pool probabilities before use', () => {
  assert.match(shop, /shop\.pools\.find\(\(candidate\) => candidate\.id === ticket\.poolId\)/);
  assert.match(shop, /pool\.entries\.map/);
  assert.equal((shop.match(/coinProbabilityText\(entry\.weight, totalWeight\)/g) ?? []).length, 2);
  assert.match(shop, /disabled=\{busy \|\| result !== undefined \|\| !canUse\}/);
  assert.match(shop, /parseCollectibleArtwork\(result\.summary\)/);
});

test('a base series coupon requires an explicit choice after the one-claim consequence is shown', () => {
  assert.match(collection, /시리즈당 쿠폰 1회 · 기본 수령 후 프리즘으로 변경하거나 추가 발급할 수 없어요/);
  assert.doesNotMatch(collection, /Alert\.alert/);
  assert.match(collection, /confirmingBaseFor === series\.id && series\.claimable === 'BASE' && !series\.coupon/);
  assert.match(collection, /기본 쿠폰을 지금 받을까요\?/);
  assert.match(collection, /onPress=\{\(\) => setConfirmingBaseFor\(undefined\)\}/);
  assert.match(collection, /onPress=\{onClaim\}/);
  assert.match(collection, /disabled=\{busy\}/);
});
