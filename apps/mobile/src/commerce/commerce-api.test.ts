import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommerceApiError, createCommerceApiClient } from './commerce-api';

test('reads merchant context through the explicit demo account boundary', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'staff-1',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/merchant/merchants/merchant-1/context');
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'staff-1');
      return Response.json({
        merchantId: 'merchant-1',
        role: 'STAFF',
        permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
      });
    },
  });

  assert.deepEqual(await client.getMerchantContext('merchant-1'), {
    merchantId: 'merchant-1',
    role: 'STAFF',
    permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
  });
});

test('issues one claim slot with the customer and merchant reference only in the POST body', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'staff-1',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/merchant/merchants/merchant-1/claim-slots');
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        customerAccountId: 'customer-1',
        merchantReference: 'demo-order-1',
      });
      return Response.json(
        {
          claimSlotId: 'claim-slot-1',
          token: 'one-time-token',
          tokenVersion: 1,
          expiresAt: '2026-09-19T05:00:00.000Z',
        },
        { status: 201 },
      );
    },
  });

  assert.equal(
    (
      await client.issueClaim({
        merchantId: 'merchant-1',
        customerAccountId: 'customer-1',
        merchantReference: 'demo-order-1',
      })
    ).token,
    'one-time-token',
  );
});

test('keeps the claim token out of preview and redeem URLs', async () => {
  const requestedUrls: string[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async (input, init) => {
      requestedUrls.push(String(input));
      const body = JSON.parse(String(init?.body)) as { token: string };
      assert.equal(body.token, 'secret-claim-token');
      if (String(input).endsWith('/preview')) {
        return Response.json({
          claimSlotId: 'claim-slot-1',
          merchantId: 'merchant-1',
          expiresAt: '2026-09-19T05:00:00.000Z',
          status: 'AVAILABLE',
        });
      }
      return Response.json({
        claimSlotId: 'claim-slot-1',
        merchantId: 'merchant-1',
        status: 'CLAIMED',
        visit: {
          visitEventId: 'visit-1',
          campaignId: 'campaign-1',
          businessDate: '2026-09-19',
          verificationLevel: 'MERCHANT_CONFIRMED',
          progressCounted: true,
          progressVisitCount: 1,
        },
        grantedRewards: [],
      });
    },
  });

  await client.previewClaim('secret-claim-token');
  await client.redeemClaim('secret-claim-token');

  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls.some((url) => url.includes('secret-claim-token')), false);
});

test('parses collection states while keeping app collectibles and NFT state separate', async () => {
  const payload = {
    visits: [
      {
        visitEventId: 'visit-1',
        merchantId: 'merchant-1',
        merchantName: '월계 밥상',
        campaignId: 'campaign-1',
        campaignTitle: '월계 한 바퀴',
        businessDate: '2026-09-19',
        progressCounted: true,
        verificationLevel: 'MERCHANT_CONFIRMED',
      },
    ],
    collectibles: [
      {
        entitlementId: 'entitlement-1',
        merchantId: 'merchant-1',
        merchantName: '월계 밥상',
        campaignId: 'campaign-1',
        campaignTitle: '월계 한 바퀴',
        targetVisitCount: 1,
        displayName: '첫 밥상 잎새',
        appCollectibleStatus: 'COLLECTED',
        mintJobId: null,
        recipient: null,
        nftStatus: 'NOT_REQUESTED',
        nft: null,
      },
    ],
  };
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/collection');
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'customer-1');
      return Response.json(payload);
    },
  });

  assert.deepEqual(await client.getCollection(), payload);
});

test('requests minting with binding and consent only, never a client recipient or series', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/entitlements/entitlement-1/mint');
      assert.equal(new Headers(init?.headers).get('idempotency-key'), 'mint-request-1');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        walletBindingId: 'binding-1',
        bindingVersion: 2,
        consentVersion: 'nft-mint-v1',
      });
      return Response.json(
        {
          jobId: 'job-1',
          status: 'QUEUED',
          chainId: 84532,
          recipient: '0x4000000000000000000000000000000000000004',
          nft: null,
          replayed: false,
        },
        { status: 202 },
      );
    },
  });

  const result = await client.requestMint({
    entitlementId: 'entitlement-1',
    walletBindingId: 'binding-1',
    bindingVersion: 2,
    consentVersion: 'nft-mint-v1',
    idempotencyKey: 'mint-request-1',
  });

  assert.equal(result.status, 'QUEUED');
  assert.equal(result.replayed, false);
});

test('rejects malformed collection data', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async () => Response.json({ visits: [], collectibles: [{ nftStatus: 'MINTED' }] }),
  });

  await assert.rejects(client.getCollection(), /도감 응답 형식/);
});

test('preserves API status and code for Korean recovery messages', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'customer-1',
    fetcher: async () => Response.json({ code: 'CLAIM_TOKEN_EXPIRED' }, { status: 410 }),
  });

  await assert.rejects(client.previewClaim('expired-token'), (error: unknown) => {
    assert.ok(error instanceof CommerceApiError);
    assert.equal(error.status, 410);
    assert.equal(error.code, 'CLAIM_TOKEN_EXPIRED');
    return true;
  });
});
