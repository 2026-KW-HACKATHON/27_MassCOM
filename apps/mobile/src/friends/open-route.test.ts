import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

test('the open route sends a friend link to the friends tab, a merchant link to the shop, and anything else home', () => {
  const route = read('../app/open.tsx');
  assert.match(route, /Linking\.useLinkingURL\(\)/);
  assert.match(route, /useLocalSearchParams<\{ '#'\?: string \}>\(\)/);
  // Each build reads only its own links, told apart by its installed package.
  assert.match(route, /resolveOpenTarget\(url, fragment, linkVariantFor\(Application\.applicationId\)\)/);
  assert.match(route, /rememberPendingFriendCode\(target\.code\);\s*router\.replace\('\/friends'\)/);
  // A friend link that cannot be used still opens the friends tab, which says why in one line.
  assert.match(route, /rememberPendingFriendProblem\(target\.problem\);\s*router\.replace\('\/friends'\)/);
  assert.match(route, /router\.replace\(\{ pathname: '\/merchants\/\[merchantId\]', params: \{ merchantId: target\.merchantId \} \}\)/);
  assert.match(route, /router\.replace\('\/'\)/);
  // The code is never logged or put into a query.
  assert.doesNotMatch(route, /console\.|\?friend=/);
});

test('the open route forgets the delivered link once handled, so iOS cannot hand the first universal link back again', () => {
  const route = read('../app/open.tsx');
  // expo-linking exports it, both native modules implement it and it is optional-chained inside (a no-op on web).
  assert.match(route, /import \* as Linking from 'expo-linking'/);
  assert.match(route, /Linking\.clearInitialURL\(\);\s*\}, \[fragment, router, url\]\)/);
  // Each link is still handled once: the guard sits before the routing and the clear.
  assert.match(route, /if \(handled\.current === key\) return;\s*handled\.current = key;/);
  assert.ok(route.indexOf('handled.current = key') < route.indexOf('router.replace'));
  assert.ok(route.indexOf('router.replace') < route.indexOf('Linking.clearInitialURL()'));
});

test('a friend link opened while signed out continues at the friends tab after sign-in, next to the merchant return', () => {
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /consumeMerchantReturn\(\)/);
  assert.match(layout, /else if \(hasPendingFriendLink\(\)\) router\.replace\('\/friends'\)/);
  const screen = read('../screens/friends/index.tsx');
  assert.match(screen, /const pending = consumePendingFriendCode\(\);/);
  assert.match(screen, /const problem = consumePendingFriendProblem\(\);\s*if \(problem\) setAddNotice\(\{ tone: 'error', text: friendLinkProblemMessage\(problem\) \}\);\s*if \(pending\) confirmAdd\(pending\)/);
});

test('a waiting friend link is forgotten when the account signs out, switches or its session ends', () => {
  const provider = read('../auth/auth-provider.tsx');
  assert.match(provider, /import \{ clearPendingFriendLink \} from '@\/friends\/pending-friend-link'/);
  for (const method of ['logout', 'switchAccount', 'invalidateSession']) {
    assert.match(provider, new RegExp(`async ${method}\\(\\) \\{(\\s*//[^\\n]*)?\\s*clearPendingFriendLink\\(\\);`), method);
  }
});

test('the app declares the HTTPS open link the friend and merchant links use', () => {
  const config = read('../../app.config.ts');
  assert.match(config, /pathPrefix: '\/open'/);
  assert.match(config, /host: showcase \? 'demo\.masscom\.kr' : 'masscom\.kr'/);
});
