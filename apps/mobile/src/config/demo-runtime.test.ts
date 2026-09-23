import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canOpenMerchantDemo, getDemoRuntimeConfig, isDevelopmentDemoBuild } from './demo-runtime';

test('development demo authentication belongs only to the exact dev package', () => {
  assert.equal(isDevelopmentDemoBuild('kr.masscom.wolgye.dev'), true);
  for (const applicationId of [
    'kr.masscom.wolgye',
    'kr.masscom.wolgye.demo',
    'kr.masscom.wolgye.dev.attacker',
    'unknown',
    null,
    undefined,
  ]) {
    assert.equal(isDevelopmentDemoBuild(applicationId), false, `${applicationId}`);
  }
});

test('keeps customer and merchant demo identities separate', () => {
  assert.deepEqual(
    getDemoRuntimeConfig({
      EXPO_PUBLIC_DEMO_ACCOUNT_ID: ' customer-1 ',
      EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: ' staff-1 ',
      EXPO_PUBLIC_DEMO_MERCHANT_ID: ' merchant-1 ',
      EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION: 'true',
    }),
    {
      customerAccountId: 'customer-1',
      merchant: { accountId: 'staff-1', merchantId: 'merchant-1' },
      allowInsecureDemoReauthentication: true,
    },
  );
});

test('does not invent demo identities when variables are missing', () => {
  assert.deepEqual(getDemoRuntimeConfig({}), {
    customerAccountId: undefined,
    merchant: undefined,
    allowInsecureDemoReauthentication: false,
  });
});

test('merchant demo link is unavailable to production accounts and incomplete demos', () => {
  const configured = getDemoRuntimeConfig({
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: 'staff-1',
    EXPO_PUBLIC_DEMO_MERCHANT_ID: 'merchant-1',
  });
  assert.equal(canOpenMerchantDemo({ kind: 'bearer', sessionToken: 'test' }, configured), false);
  assert.equal(canOpenMerchantDemo({ kind: 'demo', accountId: 'account-1', allowInsecureReauthentication: false }, getDemoRuntimeConfig({})), false);
  assert.equal(canOpenMerchantDemo({ kind: 'demo', accountId: 'account-1', allowInsecureReauthentication: false }, configured), true);
});
