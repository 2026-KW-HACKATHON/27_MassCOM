import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('the open route sends a friend link to the friends tab, a merchant link to the shop, and anything else home', () => {
  const route = read('../app/open.tsx');
  assert.match(route, /Linking\.useLinkingURL\(\)/);
  assert.match(route, /useLocalSearchParams<\{ '#'\?: string \}>\(\)/);
  assert.match(route, /resolveOpenTarget\(url, fragment\)/);
  assert.match(route, /rememberPendingFriendCode\(target\.code\);\s*router\.replace\('\/friends'\)/);
  assert.match(route, /router\.replace\(\{ pathname: '\/merchants\/\[merchantId\]', params: \{ merchantId: target\.merchantId \} \}\)/);
  assert.match(route, /router\.replace\('\/'\)/);
  // The code is never logged or put into a query.
  assert.doesNotMatch(route, /console\.|\?friend=/);
});

test('a friend link opened while signed out continues at the friends tab after sign-in, next to the merchant return', () => {
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /consumeMerchantReturn\(\)/);
  assert.match(layout, /else if \(peekPendingFriendCode\(\)\) router\.replace\('\/friends'\)/);
  const screen = read('../screens/friends/index.tsx');
  assert.match(screen, /const pending = consumePendingFriendCode\(\);\s*if \(pending\) confirmAdd\(pending\)/);
});

test('the app declares the HTTPS open link the friend and merchant links use', () => {
  const config = read('../../app.config.ts');
  assert.match(config, /pathPrefix: '\/open'/);
  assert.match(config, /host: showcase \? 'demo\.masscom\.kr' : 'masscom\.kr'/);
});
