import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { canUseDemoHandoff, clearDemoHandoff, setDemoHandoff, takeDemoHandoff } from './demo-handoff';

const later = new Date(Date.now() + 120_000).toISOString();
const earlier = new Date(Date.now() - 1_000).toISOString();

test('the account that handed a value over takes it once, then it is gone', () => {
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'claim-token', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a'), 'claim-token');
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
});

test('another account gets nothing, and the value is cleared so it cannot be picked up later', () => {
  setDemoHandoff({ kind: 'identity', accountId: 'account-a', token: 'identity-token', expiresAt: later });
  assert.equal(takeDemoHandoff('identity', 'account-b'), undefined);
  assert.equal(takeDemoHandoff('identity', 'account-a'), undefined, 'account A cannot get it back once B asked');
  // The other kind is not B's either: asking for it clears the value too.
  setDemoHandoff({ kind: 'identity', accountId: 'account-a', token: 'identity-token', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-b'), undefined);
  assert.equal(takeDemoHandoff('identity', 'account-a'), undefined);
});

test('taking the other kind leaves the value for its own screen (same account)', () => {
  setDemoHandoff({ kind: 'identity', accountId: 'account-a', token: 'identity-token', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
  assert.equal(takeDemoHandoff('identity', 'account-a'), 'identity-token');
  assert.equal(takeDemoHandoff('identity', 'account-a'), undefined);
});

test('an expired or malformed handoff is dropped, and a newer one replaces the older', () => {
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'late', expiresAt: earlier });
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'bad-time', expiresAt: 'not-a-date' });
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
  setDemoHandoff({ kind: 'claim', accountId: '', token: 'no-owner', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', ''), undefined, 'a value with no owner is never stored');
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'first', expiresAt: later });
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'second', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a'), 'second');
});

test('an expired value is dropped whichever kind asks, while a live value of the other kind stays', () => {
  setDemoHandoff({ kind: 'identity', accountId: 'account-a', token: 'identity-token', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a', Date.parse(later) + 1), undefined, 'the claim screen sees the stale identity and drops it');
  assert.equal(takeDemoHandoff('identity', 'account-a'), undefined, 'so the identity screen finds nothing left');
  setDemoHandoff({ kind: 'identity', accountId: 'account-a', token: 'identity-token', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
  assert.equal(takeDemoHandoff('identity', 'account-a'), 'identity-token', 'a live value of the other kind is untouched');
});

test('a value taken after its expiry is refused and cleared', () => {
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'soon-gone', expiresAt: later });
  assert.equal(takeDemoHandoff('claim', 'account-a', Date.parse(later) + 1), undefined);
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined, 'the expired value does not come back');
});

test('clearing on sign-out, account switch or session invalidation leaves nothing for the same account either', () => {
  setDemoHandoff({ kind: 'claim', accountId: 'account-a', token: 'claim-token', expiresAt: later });
  clearDemoHandoff();
  assert.equal(takeDemoHandoff('claim', 'account-a'), undefined);
  clearDemoHandoff();
});

test('every way out of an account clears the waiting handoff', () => {
  const provider = readFileSync(fileURLToPath(new URL('../auth/auth-provider.tsx', import.meta.url)), 'utf8');
  assert.match(provider, /import \{ clearDemoHandoff \} from '@\/navigation\/demo-handoff';/);
  for (const method of ['restartGuestTrial', 'logout', 'switchAccount']) {
    const body = provider.split(`async ${method}() {`)[1]?.split(/\n    async /)[0];
    assert.ok(body, method);
    assert.match(body, /clearDemoHandoff\(\);/, method);
  }
  const invalidation = provider.split('async invalidateSession() {')[1]?.split('},')[0];
  assert.ok(invalidation);
  assert.match(invalidation, /sessionToken !== session\.sessionToken\) return;[\s\S]*?clearDemoHandoff\(\);/);
});

test('the role switch lands on the claim screen in the development build too, whose credential is the demo one', () => {
  const layout = readFileSync(fileURLToPath(new URL('../app/_layout.tsx', import.meta.url)), 'utf8');
  assert.match(layout, /if \(auth\.state\.status !== 'signedIn' && auth\.state\.status !== 'demo'\) return;\s*const target = consumeInternalAuthReturn\(\);/);
});

test('the handoff lives in memory only: no storage, URL or log in the module', () => {
  const source = readFileSync(new URL('./demo-handoff.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AsyncStorage|SecureStore|secure-store|localStorage|sessionStorage|console\.|router|Linking|window\./);
  assert.doesNotMatch(source, /^import .*(storage|store)/mi);
});

test('the guided handoff exists in the showcase and development builds and is absent from the operating identity', () => {
  assert.equal(canUseDemoHandoff('kr.masscom.wolgye.demo'), true);
  assert.equal(canUseDemoHandoff('kr.masscom.wolgye.dev'), true);
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.demo.evil', null, undefined, '']) {
    assert.equal(canUseDemoHandoff(packageId), false, String(packageId));
  }
});
