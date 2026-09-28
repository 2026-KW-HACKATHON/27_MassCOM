import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommerceApiError, createCommerceApiClient } from './commerce-api';

const identityToken = `masscom-customer:v1:${'A'.repeat(43)}`;

test('creates, resolves, and revokes customer identity only through authenticated POST bodies', async () => {
  const requests: { url: string; body: unknown }[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer session');
      const url = String(input);
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith('/resolve')) return Response.json({ expiresAt: '2026-09-28T10:00:00.000Z' });
      if (url.endsWith('/revoke')) return Response.json({ status: 'REVOKED' });
      return Response.json({ token: identityToken, expiresAt: '2026-09-28T10:00:00.000Z' }, { status: 201 });
    },
  });
  assert.deepEqual(await client.createCustomerIdentity(), { token: identityToken, expiresAt: '2026-09-28T10:00:00.000Z' });
  assert.deepEqual(await client.resolveCustomerIdentity('merchant-1', identityToken), { expiresAt: '2026-09-28T10:00:00.000Z' });
  await client.revokeCustomerIdentity(identityToken);
  assert.deepEqual(requests, [
    { url: 'https://api.example.test/customer/identity-tokens', body: {} },
    { url: 'https://api.example.test/merchant/merchants/merchant-1/customer-identities/resolve', body: { customerIdentityToken: identityToken } },
    { url: 'https://api.example.test/customer/identity-tokens/revoke', body: { token: identityToken } },
  ]);
});

test('issues a confirmed identity claim without account ID and accepts replay without a token', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/merchant/merchants/merchant-1/claim-slots');
      assert.deepEqual(JSON.parse(String(init?.body)), {
        customerIdentityToken: identityToken, merchantReference: identityToken, useConfirmed: true,
      });
      return Response.json({ claimSlotId: 'slot-1', tokenVersion: 1, expiresAt: '2026-09-28T10:00:00.000Z', replayed: true });
    },
  });
  assert.deepEqual(await client.issueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken }), {
    claimSlotId: 'slot-1', tokenVersion: 1, expiresAt: '2026-09-28T10:00:00.000Z', replayed: true,
  });
});

test('recovers a lost issue response by reissuing the existing slot', async () => {
  const urls: string[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      urls.push(String(input));
      if (urls.length === 1) {
        // The same identity token is the stable reference across retry; the server stores only its merchant-scoped HMAC.
        assert.deepEqual(JSON.parse(String(init?.body)), {
          customerIdentityToken: identityToken, merchantReference: identityToken, useConfirmed: true,
        });
        return Response.json({ claimSlotId: 'slot-1', tokenVersion: 2, expiresAt: '2026-09-28T10:00:00.000Z', replayed: true });
      }
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedTokenVersion: 2 });
      return Response.json({ claimSlotId: 'slot-1', token: 'B'.repeat(43), tokenVersion: 3, expiresAt: '2026-09-28T10:02:00.000Z' });
    },
  });
  assert.equal((await client.issueOrReissueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken })).tokenVersion, 3);
  assert.deepEqual(urls, [
    'https://api.example.test/merchant/merchants/merchant-1/claim-slots',
    'https://api.example.test/merchant/merchants/merchant-1/claim-slots/slot-1/reissue',
  ]);
});

test('recovers a lost reissue response through the same identity reference and server replay', async () => {
  const requests: string[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/reissue') && requests.length === 1) throw new TypeError('response lost');
      if (url.endsWith('/reissue')) {
        assert.deepEqual(JSON.parse(String(init?.body)), { expectedTokenVersion: 2 });
        return Response.json({ claimSlotId: 'slot-1', token: 'C'.repeat(43), tokenVersion: 3, expiresAt: '2026-09-28T10:02:00.000Z' });
      }
      assert.deepEqual(JSON.parse(String(init?.body)), {
        customerIdentityToken: identityToken, merchantReference: identityToken, useConfirmed: true,
      });
      return Response.json({ claimSlotId: 'slot-1', tokenVersion: 2, expiresAt: '2026-09-28T10:00:00.000Z', replayed: true });
    },
  });
  await assert.rejects(client.reissueClaim({ merchantId: 'merchant-1', claimSlotId: 'slot-1', expectedTokenVersion: 1 }), /response lost/);
  assert.equal((await client.issueOrReissueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken })).tokenVersion, 3);
  assert.deepEqual(requests, [
    'https://api.example.test/merchant/merchants/merchant-1/claim-slots/slot-1/reissue',
    'https://api.example.test/merchant/merchants/merchant-1/claim-slots',
    'https://api.example.test/merchant/merchants/merchant-1/claim-slots/slot-1/reissue',
  ]);
});

test('rejects malformed identity responses before displaying them', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ token: 'bad', expiresAt: 'not-a-date' }),
  });
  await assert.rejects(client.createCustomerIdentity(), /응답 형식/);
});

test('reads merchant context through the explicit demo account boundary', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'staff-1', allowInsecureReauthentication: false },
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/merchant/merchants/merchant-1/context');
      assert.equal(new Headers(init?.headers).get('x-account-id'), 'staff-1');
      assert.equal(new Headers(init?.headers).has('authorization'), false);
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
    credential: { kind: 'demo', accountId: 'staff-1', allowInsecureReauthentication: false },
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
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async (input, init) => {
      requestedUrls.push(String(input));
      const body = JSON.parse(String(init?.body)) as { token: string };
      assert.equal(body.token, 'secret-claim-token');
      if (String(input).endsWith('/preview')) {
        return Response.json({
          claimSlotId: 'claim-slot-1',
          merchantId: 'merchant-1',
          merchantName: '월계 밥상',
          campaignId: 'campaign-1',
          campaignTitle: '월계 한 바퀴',
          expiresAt: '2026-09-19T05:00:00.000Z',
          status: 'AVAILABLE',
        });
      }
      return Response.json({
        claimSlotId: 'claim-slot-1',
        merchantId: 'merchant-1',
        merchantName: '월계 밥상',
        campaignTitle: '월계 한 바퀴',
        status: 'CLAIMED',
        replayed: false,
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

test('rejects preview and redeem responses without user-facing recovery fields', async () => {
  const responses = [
    {
      claimSlotId: 'claim-slot-1',
      merchantId: 'merchant-1',
      campaignId: 'campaign-1',
      campaignTitle: '월계 한 바퀴',
      expiresAt: '2026-09-19T05:00:00.000Z',
      status: 'AVAILABLE',
    },
    {
      claimSlotId: 'claim-slot-1',
      merchantId: 'merchant-1',
      merchantName: '월계 밥상',
      campaignTitle: '월계 한 바퀴',
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
    },
  ];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async () => Response.json(responses.shift()),
  });
  await assert.rejects(client.previewClaim('token'), /수령 확인 응답 형식/);
  await assert.rejects(client.redeemClaim('token'), /방문 수령 응답 형식/);
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
    credential: { kind: 'bearer', sessionToken: 'server-session' },
    fetcher: async (input, init) => {
      assert.equal(input, 'https://api.example.test/collection');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer server-session');
      assert.equal(headers.has('x-account-id'), false);
      return Response.json(payload);
    },
  });

  assert.deepEqual(await client.getCollection(), payload);
});

test('requests minting with binding and consent only, never a client recipient or series', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
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
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async () => Response.json({ visits: [], collectibles: [{ nftStatus: 'MINTED' }] }),
  });

  await assert.rejects(client.getCollection(), /도감 응답 형식/);
});

test('preserves API status and code for Korean recovery messages', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async () => Response.json({ code: 'CLAIM_TOKEN_EXPIRED' }, { status: 410 }),
  });

  await assert.rejects(client.previewClaim('expired-token'), (error: unknown) => {
    assert.ok(error instanceof CommerceApiError);
    assert.equal(error.status, 410);
    assert.equal(error.code, 'CLAIM_TOKEN_EXPIRED');
    return true;
  });
});

test('invalidates a rejected bearer session once', async () => {
  let invalidations = 0;
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'expired-session' },
    onSessionInvalid: async () => { invalidations += 1; },
    fetcher: async () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 }),
  });
  await assert.rejects(client.getCollection(), /SESSION_INVALID/);
  assert.equal(invalidations, 1);
});

test('merchant context and claim issue both invoke bearer session recovery on expiry', async () => {
  const paths: string[] = [];
  let invalidations = 0;
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'expired-session' },
    onSessionInvalid: async () => { invalidations += 1; },
    fetcher: async (input) => {
      paths.push(String(input));
      return Response.json({ code: 'SESSION_INVALID' }, { status: 401 });
    },
  });
  await assert.rejects(client.getMerchantContext('store-a'), /SESSION_INVALID/);
  await assert.rejects(client.issueClaim({
    merchantId: 'store-a', customerAccountId: 'customer-a', merchantReference: 'visit-a',
  }), /SESSION_INVALID/);
  assert.deepEqual(paths, [
    'https://api.example.test/merchant/merchants/store-a/context',
    'https://api.example.test/merchant/merchants/store-a/claim-slots',
  ]);
  assert.equal(invalidations, 2);
});
