import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommerceApiError, createCommerceApiClient } from './commerce-api';

const identityToken = `masscom-customer:v1:${'A'.repeat(43)}`;

const collectiblePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
const collectibleDetail = {
  publicationId: 'publication-1', projectId: 'project-1', gradeId: 'bronze', gradeName: '브론즈',
  name: '첫 방문 동전', shape: 'circle', theme: { name: '기본' }, thumbnailDataUrl: collectiblePng,
  imageDataUrl: collectiblePng, thickness: 8, angle: 0, animation: 'still', greeting: '', audio: null,
  story: { type: 'none', frames: [], cartoon: 0, strength: 50 },
};

test('수집품 상세는 보상권 경로를 인코딩하고 현재 계정 인증으로만 읽는다', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'customer-session' },
    fetcher: async (input, init) => {
      assert.equal(String(input), 'https://api.example.test/collectibles/entitlement%2F1');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer customer-session');
      assert.equal(new Headers(init?.headers).has('x-account-id'), false);
      assert.equal(init?.body, undefined);
      return Response.json({ ...collectibleDetail, photo: { originalDataUrl: 'private' } });
    },
  });
  assert.deepEqual(await client.getCollectible('entitlement/1'), collectibleDetail);
});

test('수집품 상세의 다른 보유자 거절과 세션 만료를 성공으로 바꾸지 않는다', async () => {
  let invalidations = 0;
  for (const [status, code] of [[404, 'COLLECTIBLE_NOT_FOUND'], [401, 'SESSION_INVALID']] as const) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      onSessionInvalid: async () => { invalidations += 1; },
      fetcher: async () => Response.json({ code }, { status }),
    });
    await assert.rejects(client.getCollectible('foreign-entitlement'), (error: unknown) => error instanceof CommerceApiError && error.status === status && error.code === code);
  }
  assert.equal(invalidations, 1);
});

test('수집품 상세의 잘못된 미디어 응답은 표시하기 전에 거절한다', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ ...collectibleDetail, imageDataUrl: 'https://example.test/arbitrary.png' }),
  });
  await assert.rejects(client.getCollectible('entitlement-1'), /가게 수집품 응답 형식/);
});

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

test('looks up and redeems staff coupons with the identity token only in encoded POST paths and bodies', async () => {
  const requests: { url: string; body: unknown }[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer session');
      const url = String(input);
      requests.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith('/lookup')) {
        return Response.json({
          identityExpiresAt: '2026-09-28T10:00:00.000Z',
          coupons: [{ couponId: 'coupon-1', title: '체험 음료 1잔', detail: '가상 점포 체험 혜택', expiresAt: '2026-10-28T10:00:00.000Z', extra: 'ignored' }],
        });
      }
      return Response.json({ couponId: 'coupon/1', status: 'REDEEMED', redeemedAt: '2026-09-28T09:00:00.000Z', replayed: false });
    },
  });
  assert.deepEqual(await client.lookupCustomerCoupons('merchant/1', identityToken), {
    identityExpiresAt: '2026-09-28T10:00:00.000Z',
    coupons: [{ couponId: 'coupon-1', title: '체험 음료 1잔', detail: '가상 점포 체험 혜택', expiresAt: '2026-10-28T10:00:00.000Z' }],
  });
  assert.deepEqual(await client.redeemCustomerCoupon({ merchantId: 'merchant/1', couponId: 'coupon/1', customerIdentityToken: identityToken }), {
    couponId: 'coupon/1', status: 'REDEEMED', redeemedAt: '2026-09-28T09:00:00.000Z', replayed: false,
  });
  assert.deepEqual(requests, [
    { url: 'https://api.example.test/merchant/merchants/merchant%2F1/coupons/lookup', body: { customerIdentityToken: identityToken } },
    { url: 'https://api.example.test/merchant/merchants/merchant%2F1/coupons/coupon%2F1/redeem', body: { customerIdentityToken: identityToken } },
  ]);
});

test('accepts an empty coupon list and a replayed redeem', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input) => String(input).endsWith('/lookup')
      ? Response.json({ identityExpiresAt: '2026-09-28T10:00:00.000Z', coupons: [] })
      : Response.json({ couponId: 'coupon-1', status: 'REDEEMED', redeemedAt: '2026-09-28T09:00:00.000Z', replayed: true }),
  });
  assert.deepEqual((await client.lookupCustomerCoupons('merchant-1', identityToken)).coupons, []);
  assert.equal((await client.redeemCustomerCoupon({ merchantId: 'merchant-1', couponId: 'coupon-1', customerIdentityToken: identityToken })).replayed, true);
});

test('rejects malformed coupon lookup and redeem responses before displaying them', async () => {
  const lookupBodies = [
    {},
    { identityExpiresAt: 'not-a-date', coupons: [] },
    { identityExpiresAt: '2026-09-28T10:00:00.000Z', coupons: 'none' },
    { identityExpiresAt: '2026-09-28T10:00:00.000Z', coupons: [{ couponId: '', title: '음료', detail: '', expiresAt: '2026-10-28T10:00:00.000Z' }] },
    { identityExpiresAt: '2026-09-28T10:00:00.000Z', coupons: [{ couponId: 'c1', title: '음료', detail: '', expiresAt: 'soon' }] },
  ];
  for (const body of lookupBodies) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json(body),
    });
    await assert.rejects(client.lookupCustomerCoupons('merchant-1', identityToken), /쿠폰 조회 응답 형식/);
  }
  const redeemBodies = [
    {},
    { couponId: 'c1', status: 'ISSUED', redeemedAt: '2026-09-28T09:00:00.000Z', replayed: false },
    { couponId: 'c1', status: 'REDEEMED', redeemedAt: 'nope', replayed: false },
    { couponId: 'c1', status: 'REDEEMED', redeemedAt: '2026-09-28T09:00:00.000Z' },
  ];
  for (const body of redeemBodies) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json(body),
    });
    await assert.rejects(
      client.redeemCustomerCoupon({ merchantId: 'merchant-1', couponId: 'c1', customerIdentityToken: identityToken }),
      /쿠폰 사용 응답 형식/,
    );
  }
});

test('propagates coupon error codes and statuses for staff recovery messages', async () => {
  const cases: [number, string][] = [[404, 'COUPON_NOT_FOUND'], [409, 'COUPON_EXPIRED'], [403, 'MERCHANT_ACCESS_DENIED'], [403, 'COUPON_SELF_REDEEM'], [410, 'CUSTOMER_IDENTITY_EXPIRED']];
  for (const [status, code] of cases) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json({ code }, { status }),
    });
    for (const call of [
      () => client.lookupCustomerCoupons('merchant-1', identityToken),
      () => client.redeemCustomerCoupon({ merchantId: 'merchant-1', couponId: 'coupon-1', customerIdentityToken: identityToken }),
    ]) {
      await assert.rejects(call(), (error: unknown) => {
        assert.ok(error instanceof CommerceApiError);
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        return true;
      });
    }
  }
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

test('a lost initial response recovers after relaunch through replay, while revoked staff cannot recover', async () => {
  let calls = 0;
  let revoked = false;
  const fetcher: typeof fetch = async (input) => {
    calls += 1;
    if (revoked) return Response.json({ code: 'MERCHANT_ACCESS_DENIED' }, { status: 403 });
    if (calls === 1) throw new TypeError('response lost');
    if (String(input).endsWith('/reissue')) {
      return Response.json({ claimSlotId: 'slot-1', token: 'R'.repeat(43), tokenVersion: 2, expiresAt: '2026-10-06T10:02:00.000Z' });
    }
    return Response.json({ claimSlotId: 'slot-1', tokenVersion: 1, expiresAt: '2026-10-06T10:00:00.000Z', replayed: true });
  };
  const options = { apiUrl: 'https://api.example.test', credential: { kind: 'bearer' as const, sessionToken: 'staff-session' }, fetcher };
  await assert.rejects(createCommerceApiClient(options).issueOrReissueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken }), /response lost/);
  const recovered = await createCommerceApiClient(options).issueOrReissueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken });
  assert.equal(recovered.claimSlotId, 'slot-1');
  assert.equal(recovered.tokenVersion, 2);
  revoked = true;
  await assert.rejects(createCommerceApiClient(options).issueOrReissueIdentityClaim({ merchantId: 'merchant-1', customerIdentityToken: identityToken }),
    (error: unknown) => error instanceof CommerceApiError && error.code === 'MERCHANT_ACCESS_DENIED');
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

test('#295 테스트 방문 만들기는 merchantId만 보내고 방문 수령 응답을 그대로 읽는다', async () => {
  let requestedUrl: string | undefined;
  let requestedBody: unknown;
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body));
      return Response.json({
        claimSlotId: 'claim-slot-1',
        merchantId: 'showcase-local-merchant',
        merchantName: '가상 점포 A',
        campaignTitle: '체험 방문 도감',
        status: 'CLAIMED',
        replayed: false,
        visit: {
          visitEventId: 'visit-1',
          campaignId: 'showcase-local-campaign',
          businessDate: '2026-10-02',
          verificationLevel: 'MERCHANT_CONFIRMED',
          progressCounted: true,
          progressVisitCount: 1,
        },
        grantedRewards: [],
      });
    },
  });
  const result = await client.createTestVisit('showcase-local-merchant');
  assert.equal(requestedUrl, 'https://api.example.test/showcase/test-visits');
  assert.deepEqual(requestedBody, { merchantId: 'showcase-local-merchant' });
  assert.equal(result.merchantId, 'showcase-local-merchant');
  assert.equal(result.visit.progressCounted, true);
});

test('#295 테스트 방문 만들기는 방문 수령과 같은 오류 코드를 그대로 전달한다', async () => {
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'customer-1', allowInsecureReauthentication: false },
    fetcher: async () => Response.json({ code: 'SHOWCASE_TEST_VISIT_RATE_LIMITED' }, { status: 429 }),
  });
  await assert.rejects(client.createTestVisit('showcase-local-merchant'),
    (error: unknown) => error instanceof CommerceApiError && error.status === 429 && error.code === 'SHOWCASE_TEST_VISIT_RATE_LIMITED');
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
        publicationId: 'publication-immutable',
        displayName: '첫 밥상 잎새',
        earnedAt: '2026-09-19T03:00:00.000Z',
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

test('collection preserves acquired publication identity when artwork is withdrawn', async () => {
  const collectible = {
    entitlementId: 'entitlement-1', merchantId: 'merchant-1', merchantName: '가게',
    campaignId: 'campaign-1', campaignTitle: '캠페인', targetVisitCount: 3,
    publicationId: 'publication-old', displayName: '세 번째 보상', earnedAt: '2026-10-06T00:00:00Z',
    appCollectibleStatus: 'COLLECTED', mintJobId: null, recipient: null,
    nftStatus: 'NOT_REQUESTED', nft: null,
  };
  const client = createCommerceApiClient({ apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ visits: [], collectibles: [collectible] }) });
  assert.equal((await client.getCollection()).collectibles[0]?.publicationId, 'publication-old');
});

test('keeps the optional preparing flag from the collection and drops unknown values', async () => {
  const base = { visits: [], collectibles: [] };
  for (const [nftMinting, expected] of [
    ['PREPARING', { ...base, nftMinting: 'PREPARING' }],
    ['LIVE', base],
    [undefined, base],
  ] as const) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test',
      credential: { kind: 'bearer', sessionToken: 'server-session' },
      fetcher: async () => Response.json(nftMinting === undefined ? base : { ...base, nftMinting }),
    });
    assert.deepEqual(await client.getCollection(), expected);
  }
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

test('lists recent visits and cancels one with a fixed reason and a trimmed optional note', async () => {
  const requests: { url: string; method: string | undefined; body: unknown }[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const url = String(input);
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer session');
      requests.push({ url, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (url.endsWith('/recent-visits')) {
        return Response.json({
          businessDate: '2026-09-30',
          visits: [{ visitEventId: 'v/1', claimSlotId: 'slot-mine', occurredAt: '2026-09-30T03:05:00.000Z', customerLabel: '손님 K7QM', status: 'VALID',
            progressCounted: false, cancellationReason: null, canCancel: true, customerAccountId: 'ignored' }],
        });
      }
      return Response.json({
        visitEventId: 'v/1', status: 'CANCELED', reason: 'DUPLICATE', note: '두 번 확인',
        canceledAt: '2026-09-30T03:06:00.000Z', revokedRewardCount: 1, voidedCouponCount: 0, replayed: false,
      });
    },
  });
  const listed = await client.listRecentVisits('merchant/1');
  assert.deepEqual(listed, {
    businessDate: '2026-09-30',
    visits: [{ visitEventId: 'v/1', claimSlotId: 'slot-mine', occurredAt: '2026-09-30T03:05:00.000Z', customerLabel: '손님 K7QM', status: 'VALID',
      progressCounted: false, cancellationReason: null, canCancel: true }],
  });
  assert.equal('customerAccountId' in listed.visits[0]!, false);
  const canceled = await client.cancelVisit({ merchantId: 'merchant/1', visitEventId: 'v/1', reason: 'DUPLICATE', note: '  두 번 확인  ' });
  assert.equal(canceled.revokedRewardCount, 1);
  await client.cancelVisit({ merchantId: 'merchant/1', visitEventId: 'v/1', reason: 'OTHER', note: '   ' });
  assert.deepEqual(requests, [
    { url: 'https://api.example.test/merchant/merchants/merchant%2F1/recent-visits', method: undefined, body: undefined },
    { url: 'https://api.example.test/merchant/merchants/merchant%2F1/visits/v%2F1/cancel', method: 'POST', body: { reason: 'DUPLICATE', note: '두 번 확인' } },
    { url: 'https://api.example.test/merchant/merchants/merchant%2F1/visits/v%2F1/cancel', method: 'POST', body: { reason: 'OTHER' } },
  ]);
});

test('lists recent coupon redemptions and undoes one with an empty POST body', async () => {
  const requests: { url: string; method: string | undefined; body: unknown }[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (url.endsWith('/recent-coupon-redemptions')) {
        return Response.json({ coupons: [{ couponId: 'c/1', title: '음료 1잔', redeemedAt: '2026-09-30T03:00:00.000Z',
          customerLabel: '손님 K7QM', redeemedByMe: true, undoUntil: '2026-09-30T03:10:00.000Z', canUndo: true }] });
      }
      return Response.json({ couponId: 'c/1', status: 'ISSUED', replayed: true });
    },
  });
  assert.deepEqual(await client.listRecentCouponRedemptions('merchant-1'), [{
    couponId: 'c/1', title: '음료 1잔', redeemedAt: '2026-09-30T03:00:00.000Z', customerLabel: '손님 K7QM',
    redeemedByMe: true, undoUntil: '2026-09-30T03:10:00.000Z', canUndo: true,
  }]);
  assert.deepEqual(await client.undoCouponRedemption({ merchantId: 'merchant-1', couponId: 'c/1' }),
    { couponId: 'c/1', status: 'ISSUED', replayed: true });
  assert.deepEqual(requests, [
    { url: 'https://api.example.test/merchant/merchants/merchant-1/recent-coupon-redemptions', method: undefined, body: undefined },
    { url: 'https://api.example.test/merchant/merchants/merchant-1/coupons/c%2F1/undo-redeem', method: 'POST', body: {} },
  ]);
});

test('rejects malformed reversal responses before showing them and keeps error codes', async () => {
  const bodies: [string, unknown, (client: ReturnType<typeof createCommerceApiClient>) => Promise<unknown>, RegExp][] = [
    ['visits without a date', { visits: [] }, (client) => client.listRecentVisits('m'), /최근 방문 응답 형식/],
    ['visit without a claim slot', { businessDate: '2026-09-30', visits: [{ visitEventId: 'v', occurredAt: '2026-09-30T03:05:00.000Z',
      customerLabel: '손님', status: 'VALID', progressCounted: true, cancellationReason: null, canCancel: true }] },
      (client) => client.listRecentVisits('m'), /최근 방문 응답 형식/],
    ['visit with an empty claim slot', { businessDate: '2026-09-30', visits: [{ visitEventId: 'v', claimSlotId: '', occurredAt: '2026-09-30T03:05:00.000Z',
      customerLabel: '손님', status: 'VALID', progressCounted: true, cancellationReason: null, canCancel: true }] },
      (client) => client.listRecentVisits('m'), /최근 방문 응답 형식/],
    ['visit with a bad status', { businessDate: '2026-09-30', visits: [{ visitEventId: 'v', claimSlotId: 'slot-v', occurredAt: '2026-09-30T03:05:00.000Z',
      customerLabel: '손님', status: 'DONE', progressCounted: true, cancellationReason: null, canCancel: true }] },
      (client) => client.listRecentVisits('m'), /최근 방문 응답 형식/],
    ['visit without a label', { businessDate: '2026-09-30', visits: [{ visitEventId: 'v', claimSlotId: 'slot-v', occurredAt: '2026-09-30T03:05:00.000Z',
      customerLabel: '', status: 'VALID', progressCounted: true, cancellationReason: null, canCancel: true }] },
      (client) => client.listRecentVisits('m'), /최근 방문 응답 형식/],
    ['cancel with a wrong status', { visitEventId: 'v', status: 'VALID', reason: 'DUPLICATE', note: null,
      canceledAt: '2026-09-30T03:06:00.000Z', revokedRewardCount: 0, voidedCouponCount: 0, replayed: false },
      (client) => client.cancelVisit({ merchantId: 'm', visitEventId: 'v', reason: 'DUPLICATE' }), /방문 취소 응답 형식/],
    ['cancel with a negative count', { visitEventId: 'v', status: 'CANCELED', reason: 'DUPLICATE', note: null,
      canceledAt: '2026-09-30T03:06:00.000Z', revokedRewardCount: -1, voidedCouponCount: 0, replayed: false },
      (client) => client.cancelVisit({ merchantId: 'm', visitEventId: 'v', reason: 'DUPLICATE' }), /방문 취소 응답 형식/],
    ['redemptions not a list', { coupons: 'none' }, (client) => client.listRecentCouponRedemptions('m'), /최근 쿠폰 사용 응답 형식/],
    ['redemption without undoUntil', { coupons: [{ couponId: 'c', title: '음료', redeemedAt: '2026-09-30T03:00:00.000Z',
      customerLabel: '손님', redeemedByMe: true, undoUntil: 'soon', canUndo: true }] },
      (client) => client.listRecentCouponRedemptions('m'), /최근 쿠폰 사용 응답 형식/],
    ['undo with a wrong status', { couponId: 'c', status: 'REDEEMED', replayed: false },
      (client) => client.undoCouponRedemption({ merchantId: 'm', couponId: 'c' }), /쿠폰 되돌리기 응답 형식/],
  ];
  for (const [name, body, call, message] of bodies) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json(body),
    });
    await assert.rejects(call(client), message, name);
  }
  for (const [status, code] of [[409, 'VISIT_REWARD_ALREADY_MINTED'], [409, 'VISIT_CANCEL_WINDOW_CLOSED'], [409, 'COUPON_UNDO_WINDOW_CLOSED'], [403, 'MERCHANT_ACCESS_DENIED']] as const) {
    const client = createCommerceApiClient({
      apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json({ code }, { status }),
    });
    for (const call of [
      () => client.cancelVisit({ merchantId: 'm', visitEventId: 'v', reason: 'DUPLICATE' }),
      () => client.undoCouponRedemption({ merchantId: 'm', couponId: 'c' }),
      () => client.listRecentVisits('m'),
    ]) {
      await assert.rejects(call(), (error: unknown) => error instanceof CommerceApiError && error.status === status && error.code === code);
    }
  }
});

test('a redeemed claim carries the staff-self reason only when the server sends it', async () => {
  const claim = (visit: Record<string, unknown>) => Response.json({
    claimSlotId: 'slot-1', merchantId: 'm', merchantName: '가게', campaignTitle: '캠페인', status: 'CLAIMED', replayed: false,
    visit: { visitEventId: 'v1', campaignId: 'c1', businessDate: '2026-09-30', verificationLevel: 'MERCHANT_CONFIRMED',
      progressCounted: false, progressVisitCount: 0, ...visit },
    grantedRewards: [],
  });
  const api = (visit: Record<string, unknown>) => createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => claim(visit),
  });
  assert.equal((await api({ progressExcludedReason: 'STAFF_SELF' }).redeemClaim('token')).visit.progressExcludedReason, 'STAFF_SELF');
  // 모르는 값이나 없는 값은 기존 문구로 떨어진다(오래된 서버·새 이유 코드에도 화면이 깨지지 않는다).
  assert.equal('progressExcludedReason' in (await api({}).redeemClaim('token')).visit, false);
  assert.equal('progressExcludedReason' in (await api({ progressExcludedReason: 'SOMETHING_NEW' }).redeemClaim('token')).visit, false);
});

test('점주 체험 권한 요청 조회·생성은 인증 헤더로만 간다(#294)', async () => {
  const requests: { url: string; method: string | undefined; body: unknown }[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      requests.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (String(input).endsWith('/mine')) {
        return Response.json({ request: null, staff: false, approver: true });
      }
      return Response.json({ request: { code: 'ABCDEFGH', status: 'PENDING', createdAt: '2026-10-01T00:00:00.000Z', decidedAt: null } }, { status: 201 });
    },
  });
  assert.deepEqual(await client.getShowcaseAccessState(), { request: null, staff: false, approver: true, trialMerchantId: null });
  assert.deepEqual(await client.requestShowcaseAccess(), { code: 'ABCDEFGH', status: 'PENDING', createdAt: '2026-10-01T00:00:00.000Z', decidedAt: null });
  assert.deepEqual(requests, [
    { url: 'https://api.example.test/showcase/access-requests/mine', method: undefined, body: undefined },
    { url: 'https://api.example.test/showcase/access-requests', method: 'POST', body: {} },
  ]);
});

test('체험 로그인 계정의 권한 조회는 자기 체험 가게 id를 돌려주고, 없는 필드는 null로 본다(#309)', async () => {
  const withTrial = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'guest-session' },
    fetcher: async () => Response.json({ request: null, staff: true, approver: false, trialMerchantId: 'trial-abc123' }),
  });
  assert.deepEqual(await withTrial.getShowcaseAccessState(), { request: null, staff: true, approver: false, trialMerchantId: 'trial-abc123' });

  const olderServer = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ request: null, staff: false, approver: true }),
  });
  assert.equal((await olderServer.getShowcaseAccessState()).trialMerchantId, null);
});

test('점주 체험 권한 요청의 잘못된 응답과 요청 실패는 성공으로 바뀌지 않는다(#294)', async () => {
  const invalidMine = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ request: null, staff: false }),
  });
  await assert.rejects(invalidMine.getShowcaseAccessState(), /권한 요청 상태/);

  const rateLimited = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ code: 'SHOWCASE_ACCESS_RATE_LIMITED' }, { status: 429 }),
  });
  await assert.rejects(rateLimited.requestShowcaseAccess(), (error: unknown) => error instanceof CommerceApiError && error.status === 429 && error.code === 'SHOWCASE_ACCESS_RATE_LIMITED');
});

test('관리자 권한 요청 목록·결정은 승인자 계정으로만 가고 잘못된 응답은 거절한다(#294)', async () => {
  const requests: string[] = [];
  const client = createCommerceApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'approver-session' },
    fetcher: async (input, init) => {
      requests.push(`${init?.method ?? 'GET'} ${String(input)}`);
      if (String(input).endsWith('/access-requests')) {
        return Response.json([{ id: 'req-1', code: 'ABCDEFGH', createdAt: '2026-10-01T00:00:00.000Z' }]);
      }
      return Response.json({ status: 'APPROVED' });
    },
  });
  assert.deepEqual(await client.listPendingShowcaseAccessRequests(), [{ id: 'req-1', code: 'ABCDEFGH', createdAt: '2026-10-01T00:00:00.000Z' }]);
  await client.decideShowcaseAccessRequest({ requestId: 'req-1', decision: 'approve' });
  assert.deepEqual(requests, [
    'GET https://api.example.test/showcase/admin/access-requests',
    'POST https://api.example.test/showcase/admin/access-requests/req-1/approve',
  ]);

  const invalidDecision = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ status: 'UNKNOWN' }),
  });
  await assert.rejects(invalidDecision.decideShowcaseAccessRequest({ requestId: 'req-1', decision: 'reject' }), /권한 요청 처리/);

  const forbidden = createCommerceApiClient({
    apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json({ code: 'SHOWCASE_APPROVER_REQUIRED' }, { status: 403 }),
  });
  await assert.rejects(forbidden.listPendingShowcaseAccessRequests(), (error: unknown) => error instanceof CommerceApiError && error.status === 403 && error.code === 'SHOWCASE_APPROVER_REQUIRED');
});
