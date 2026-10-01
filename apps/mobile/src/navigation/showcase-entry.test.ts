import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canOpenDeveloperMerchantRoute, canOpenMerchantArtRoute, canOpenShowcaseTour, consumeMerchantReturn, rememberMerchantReturn, reconcileShowcaseAccount, showcaseEntryDestination, showShowcaseRoleEntry } from './showcase-entry';

test('the showcase app and the local development build open role selection before a role is chosen (#294 review finding 5)', () => {
  for (const packageId of ['kr.masscom.wolgye.demo', 'kr.masscom.wolgye.dev']) {
    assert.equal(showShowcaseRoleEntry(packageId), true, packageId);
    assert.equal(showShowcaseRoleEntry(packageId, 'customer'), false, packageId);
    assert.equal(showShowcaseRoleEntry(packageId, 'merchant'), false, packageId);
  }
});

test('the operating package and unknown packages never show role selection', () => {
  for (const packageId of ['kr.masscom.wolgye', null, undefined, '']) {
    assert.equal(showShowcaseRoleEntry(packageId), false, String(packageId));
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

test('a local QA development build also reaches the merchant gate once a role is chosen, but the operating package never does (#294, review finding 5)', () => {
  // The dev package opens the same role-selection entry the demo package does: without this, selectedRole could never become
  // 'merchant' for the dev package and the branch below would be unreachable.
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.dev', undefined, true), 'role');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.dev', 'merchant', true), 'merchant');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye.dev', 'merchant', false), 'auth');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', 'merchant', true), 'customer');
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', 'merchant', false), 'customer');
  // The operating package must never reach role selection or the merchant gate, with or without a role.
  assert.equal(showcaseEntryDestination('kr.masscom.wolgye', undefined, true), 'customer');
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

test('the owner art page opens in the showcase app and the local development build, never the operating app', () => {
  assert.equal(canOpenMerchantArtRoute('kr.masscom.wolgye.demo'), true);
  assert.equal(canOpenMerchantArtRoute('kr.masscom.wolgye.dev'), true);
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.demo.evil', 'kr.masscom.wolgye.dev.evil', null, undefined, '']) {
    assert.equal(canOpenMerchantArtRoute(packageId), false, String(packageId));
  }
});
