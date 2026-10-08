import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommerceApiError, type MerchantContext } from '@/commerce/commerce-api';
import { findShowcaseStaffMerchant, showcaseOwnerMerchantIds } from './showcase-staff';

test('owner entry probes only the account trial store or authorized private practice store', () => {
  assert.deepEqual(showcaseOwnerMerchantIds({ trialMerchantId: 'trial-mine', practiceMerchantId: 'showcase-practice-merchant' }), ['trial-mine']);
  assert.deepEqual(showcaseOwnerMerchantIds({ trialMerchantId: null, practiceMerchantId: 'showcase-practice-merchant' }), ['showcase-practice-merchant']);
  assert.deepEqual(showcaseOwnerMerchantIds({ trialMerchantId: null, practiceMerchantId: null }), []);
});

test('showcase staff entry accepts only server-confirmed visit permission', async () => {
  const allowed: MerchantContext = {
    merchantId: 'store-b', role: 'STAFF', permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
  };
  const result = await findShowcaseStaffMerchant(['store-a', 'store-b'], async (id) => {
    if (id === 'store-a') throw new CommerceApiError(403, 'MERCHANT_ACCESS_DENIED');
    return allowed;
  });
  assert.deepEqual(result, allowed);
});

test('a role card alone cannot grant staff access', async () => {
  const result = await findShowcaseStaffMerchant(['store-a'], async () => ({
    merchantId: 'store-a', role: 'STAFF', permissions: ['VIEW_MERCHANT'],
  }));
  assert.equal(result, undefined);
});

test('network errors remain visible instead of being mistaken for no permission', async () => {
  await assert.rejects(
    () => findShowcaseStaffMerchant(['store-a'], async () => {
      throw new CommerceApiError(503, 'RPC_UNAVAILABLE');
    }),
    /RPC_UNAVAILABLE/,
  );
});

test('showcase invitation revocation is not treated as ordinary missing staff permission', async () => {
  await assert.rejects(
    () => findShowcaseStaffMerchant(['store-a'], async () => {
      throw new CommerceApiError(403, 'INVITE_REQUIRED');
    }),
    /INVITE_REQUIRED/,
  );
});
