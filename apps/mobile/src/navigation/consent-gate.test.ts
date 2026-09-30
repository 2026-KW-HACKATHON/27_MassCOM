import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');

test('the consent screen is asked for before the showcase merchant screen and before the main tabs, for both apps', () => {
  const gate = layout.indexOf('<ConsentScreen');
  assert.ok(gate > 0, 'the root layout renders the consent screen');
  assert.ok(gate < layout.indexOf("destination === 'merchant' && auth.accountId"), 'before the showcase merchant screen');
  assert.ok(gate < layout.indexOf('if (!auth.appKit) return <Routes />;'), 'before the main routes');
  assert.ok(gate < layout.indexOf('<AppKitProvider'), 'before the wallet provider and the tabs it wraps');
  // One shared code path: no package check decides who is asked (D-038: 공통 기능은 공통 코드).
  const block = layout.slice(layout.indexOf('// 첫 로그인 동의'), layout.indexOf("destination === 'merchant' && auth.accountId"));
  assert.doesNotMatch(block, /applicationId|kr\.masscom/);
});

test('only a real signed-in bearer session on a configured API is asked, and the answer is kept per account in memory', () => {
  const block = layout.slice(layout.indexOf('// 첫 로그인 동의'), layout.indexOf("destination === 'merchant' && auth.accountId"));
  // The decision is the pure function in consent-flow.ts (unit-tested there), fed the live auth state.
  assert.match(block, /shouldAskConsent\(\{[\s\S]*status: auth\.state\.status[\s\S]*consentedAccountId[\s\S]*\}\)/);
  assert.match(block, /publicApiConfig\.available/);
  assert.doesNotMatch(block, /consentedAccountId !== auth\.accountId/, 'the comparison lives in shouldAskConsent, not inline');
  assert.match(block, /key=\{auth\.accountId\}/);
  assert.match(block, /onLogout=\{auth\.logout\}/);
  assert.match(block, /onSessionInvalid=\{auth\.invalidateSession\}/);
  assert.doesNotMatch(layout, /AsyncStorage|SecureStore\.setItem/);
});
