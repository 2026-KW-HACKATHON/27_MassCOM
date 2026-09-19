import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getDemoRuntimeConfig } from './demo-runtime';

test('keeps customer and merchant demo identities separate', () => {
  assert.deepEqual(
    getDemoRuntimeConfig({
      EXPO_PUBLIC_DEMO_ACCOUNT_ID: ' customer-1 ',
      EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: ' staff-1 ',
      EXPO_PUBLIC_DEMO_MERCHANT_ID: ' merchant-1 ',
    }),
    {
      customerAccountId: 'customer-1',
      merchant: { accountId: 'staff-1', merchantId: 'merchant-1' },
    },
  );
});

test('does not invent demo identities when variables are missing', () => {
  assert.deepEqual(getDemoRuntimeConfig({}), {
    customerAccountId: undefined,
    merchant: undefined,
  });
});
