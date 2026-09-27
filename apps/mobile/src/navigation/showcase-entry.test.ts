import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canOpenDeveloperMerchantRoute, canOpenShowcaseTour, consumeMerchantReturn, rememberMerchantReturn, reconcileShowcaseAccount, showcaseEntryDestination, showShowcaseRoleEntry } from './showcase-entry';

test('only the installed showcase app opens role selection before a role is chosen', () => {
  assert.equal(showShowcaseRoleEntry('kr.masscom.wolgye.demo'), true);
  assert.equal(showShowcaseRoleEntry('kr.masscom.wolgye.demo', 'customer'), false);
  assert.equal(showShowcaseRoleEntry('kr.masscom.wolgye.demo', 'merchant'), false);
});

test('operating, development, and unknown packages keep their existing entry', () => {
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.dev', null, undefined, '']) {
    assert.equal(showShowcaseRoleEntry(packageId), false);
  }
});

test('role choice survives first sign-in but clears on sign-out or account change', () => {
  const selected = { role: 'merchant' as const, accountId: undefined };
  assert.deepEqual(reconcileShowcaseAccount(selected, 'account-a'), {
    role: 'merchant', accountId: 'account-a',
  });
  assert.deepEqual(reconcileShowcaseAccount({ role: 'merchant', accountId: 'account-a' }, undefined), {
    role: undefined, accountId: undefined,
  });
  assert.deepEqual(reconcileShowcaseAccount({ role: 'merchant', accountId: 'account-a' }, 'account-b'), {
    role: undefined, accountId: 'account-b',
  });
  const afterSignIn = reconcileShowcaseAccount(selected, 'account-a');
  assert.deepEqual(reconcileShowcaseAccount(afterSignIn, 'account-b'), {
    role: undefined, accountId: 'account-b',
  });
});

test('signed-out customers browse while merchant entry still requires authentication', () => {
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', undefined, false), 'role');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', 'customer', false), 'customer');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', 'merchant', false), 'auth');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', 'customer', true), 'customer');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.demo', 'merchant', true), 'merchant');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', undefined, true), 'customer');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', undefined, false), 'customer');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', 'merchant', true), 'customer');
});

test('the empty five-space tour is available only to the installed showcase app', () => {
  assert.equal(canOpenShowcaseTour('kr.masscom.wolgye.demo'), true);
  assert.equal(canOpenShowcaseTour('kr.masscom.wolgye'), false);
  assert.equal(canOpenShowcaseTour('kr.masscom.wolgye.dev'), false);
});

test('merchant return survives one navigation remount and cannot replay for another account', () => {
  rememberMerchantReturn('store-a');
  assert.equal(consumeMerchantReturn(), 'store-a');
  assert.equal(consumeMerchantReturn(), undefined);
  rememberMerchantReturn('store-b');
  rememberMerchantReturn(undefined);
  assert.equal(consumeMerchantReturn(), undefined);
});

test('developer merchant form requires the dev package and a demo credential', () => {
  const config = { merchant: { accountId: 'staff-demo', merchantId: 'store-a' }, allowInsecureDemoReauthentication: false };
  const demo = { kind: 'demo' as const, accountId: 'customer-demo', allowInsecureReauthentication: false };
  const bearer = { kind: 'bearer' as const, sessionToken: 'session' };
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye.dev', demo, config), true);
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye', demo, config), false);
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye.demo', demo, config), false);
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye.dev', bearer, config), false);
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye.dev', undefined, config), false);
  assert.equal(canOpenDeveloperMerchantRoute('kr.masscom.wolgye.dev', demo, { ...config, merchant: undefined }), false);
});
