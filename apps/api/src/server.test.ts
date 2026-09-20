import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { Wallet } from 'ethers';

import type { AccountDeletionService } from './account-deletion.js';
import {
  createApiServer,
  developmentHeaderAccountResolver,
  type AccountResolver,
  type ReauthenticationGuard,
} from './server.js';
import {
  CampaignEnrollmentError,
  type CampaignEnrollmentErrorCode,
  type CampaignEnrollmentService,
} from './campaign-enrollment.js';
import {
  ClaimSlotError,
  type ClaimSlotErrorCode,
  type RedeemedClaimSlot,
} from './claim-slot-service.js';
import { MerchantAccessError } from './merchant-access.js';
import type { MerchantCatalog } from './merchant-catalog.js';
import type {
  MintJobView,
  MintRequestResult,
  MintRequestService,
} from './mint-request-service.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

type MerchantAccessFixture = {
  requirePermission(input: {
    accountId: string;
    merchantId: string;
    permission: 'VIEW_MERCHANT' | 'CONFIRM_VISIT';
  }): Promise<{
    merchantId: string;
    role: 'OWNER' | 'STAFF';
    permissions: readonly ('VIEW_MERCHANT' | 'CONFIRM_VISIT')[];
  }>;
};

type ClaimSlotFixture = {
  issue(input: {
    merchantId: string;
    customerAccountId: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<{ claimSlotId: string; token: string; tokenVersion: number; expiresAt: string }>;
  reissue(input: {
    merchantId: string;
    claimSlotId: string;
    expectedTokenVersion: number;
    requestedByAccountId: string;
  }): Promise<{ claimSlotId: string; token: string; tokenVersion: number; expiresAt: string }>;
  redeem(input: {
    accountId: string;
    token: string;
  }): Promise<RedeemedClaimSlot>;
  preview(input: {
    accountId: string;
    token: string;
  }): Promise<{
    claimSlotId: string;
    merchantId: string;
    expiresAt: string;
    status: 'AVAILABLE' | 'EXPIRED';
  }>;
};

type CollectionFixture = {
  getCollection(accountId: string): Promise<{
    visits: readonly {
      visitEventId: string;
      merchantId: string;
      merchantName: string;
      campaignId: string;
      campaignTitle: string;
      businessDate: string;
      progressCounted: boolean;
      verificationLevel: 'MERCHANT_CONFIRMED' | 'POS_VERIFIED';
    }[];
    collectibles: readonly {
      entitlementId: string;
      merchantId: string;
      merchantName: string;
      campaignId: string;
      campaignTitle: string;
      targetVisitCount: 1 | 3 | 5;
      displayName: string;
      appCollectibleStatus: 'COLLECTED';
      mintJobId: string | null;
      recipient: string | null;
      nftStatus: 'NOT_REQUESTED' | 'QUEUED' | 'CONFIRMING' | 'FINALIZED' | 'REVIEW_REQUIRED';
      nft: null | { chainId: number; contractAddress: string; tokenId: string };
    }[];
  }>;
};

type RecommendationFixture = {
  listRecommendations(accountId: string): Promise<readonly {
    merchantId: string;
    merchantName: string;
    roadAddress: string;
    campaignId: string;
    campaignTitle: string;
    enrollmentStatus: 'OPEN';
    progressVisitCount: number;
    demo: boolean;
    reasonCode: 'NEW_PLACE';
    reasonText: string;
    nextGoal: {
      targetVisitCount: 1;
      displayName: string;
      remainingVisits: number;
    };
  }[]>;
};

function claimSlotFixture(overrides: Partial<ClaimSlotFixture>): ClaimSlotFixture {
  return {
    issue: async () => {
      throw new Error('unexpected claim slot issue call');
    },
    reissue: async () => {
      throw new Error('unexpected claim slot reissue call');
    },
    redeem: async () => {
      throw new Error('unexpected claim slot redeem call');
    },
    preview: async () => {
      throw new Error('unexpected claim slot preview call');
    },
    ...overrides,
  };
}

async function startFixture(
  t: TestContext,
  resolveAccountId: AccountResolver = developmentHeaderAccountResolver,
  merchantCatalog?: MerchantCatalog,
  merchantAccess?: MerchantAccessFixture,
  claimSlots?: ClaimSlotFixture,
  collection?: CollectionFixture,
  recommendations?: RecommendationFixture,
  mintRequests?: MintRequestService,
  accountDeletions?: AccountDeletionService,
  requireReauthentication?: ReauthenticationGuard,
  campaignEnrollments?: CampaignEnrollmentService,
) {
  const service = new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 5 * 60 * 1000,
    nonce: () => 'abc12345def67890',
    challengeId: () => 'challenge-http-1',
  });
  const server = createApiServer(
    service,
    resolveAccountId,
    merchantCatalog,
    merchantAccess,
    claimSlots,
    collection,
    recommendations,
    mintRequests,
    accountDeletions,
    requireReauthentication,
    campaignEnrollments,
  );

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind a TCP port');
  }

  return `http://127.0.0.1:${address.port}`;
}

test('serves health without exposing wallet data', async (t) => {
  const baseUrl = await startFixture(t);
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('lists public merchants without requiring login or a wallet', async (t) => {
  const merchant = {
    id: 'merchant-demo-noodle',
    name: '데모 국수집',
    story: '실제 협약 점포가 아닌 개발용 예시입니다.',
    roadAddress: '서울 노원구 데모로 1',
    minimumSpendWon: 10_000,
    campaign: {
      id: 'campaign-demo-autumn',
      title: '가을 방문 도감',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2026-10-31T23:59:59.000Z',
      enrollmentStatus: 'OPEN',
      rewardGoals: [
        { targetVisitCount: 1, displayName: '첫 방문 마스코트' },
        { targetVisitCount: 3, displayName: '세 번째 방문 마스코트' },
        { targetVisitCount: 5, displayName: '다섯 번째 방문 마스코트' },
      ],
    },
    demo: true,
  } as const;
  const baseUrl = await startFixture(t, developmentHeaderAccountResolver, {
    listPublicMerchants: async () => [merchant],
  });

  const response = await fetch(`${baseUrl}/merchants`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { merchants: [merchant] });
});

test('reports unavailable instead of bypassing an unconfigured merchant access boundary', async (t) => {
  const baseUrl = await startFixture(t);
  const response = await fetch(`${baseUrl}/merchant/merchants/merchant-visible/context`, {
    headers: { 'x-account-id': 'merchant-owner-1' },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'MERCHANT_ACCESS_NOT_CONFIGURED' });
});

test('returns only the authenticated member merchant context', async (t) => {
  const baseUrl = await startFixture(t, () => 'merchant-staff-1', undefined, {
    requirePermission: async ({ merchantId }) => ({
      merchantId,
      role: 'STAFF',
      permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
    }),
  });
  const response = await fetch(`${baseUrl}/merchant/merchants/merchant-visible/context`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    merchantId: 'merchant-visible',
    role: 'STAFF',
    permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
  });
});

test('returns a generic forbidden response when merchant access is denied', async (t) => {
  const baseUrl = await startFixture(t, () => 'unrelated-user', undefined, {
    requirePermission: async () => {
      throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    },
  });
  const response = await fetch(`${baseUrl}/merchant/merchants/merchant-visible/context`);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: 'MERCHANT_ACCESS_DENIED' });
});

test('does not issue claim slots when the claim service is unconfigured', async (t) => {
  const baseUrl = await startFixture(t, () => 'merchant-staff-1', undefined, {
    requirePermission: async ({ merchantId }) => ({
      merchantId,
      role: 'STAFF',
      permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
    }),
  });
  const response = await fetch(`${baseUrl}/merchant/merchants/merchant-visible/claim-slots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerAccountId: 'customer-1',
      merchantReference: 'demo-order-1',
    }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED' });
});

test('issues a one-time claim token after merchant permission succeeds', async (t) => {
  const baseUrl = await startFixture(
    t,
    () => 'merchant-staff-1',
    undefined,
    {
      requirePermission: async ({ merchantId }) => ({
        merchantId,
        role: 'STAFF',
        permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
      }),
    },
    claimSlotFixture({
      issue: async () => ({
        claimSlotId: 'claim-slot-1',
        token: 'claim-token-returned-once',
        tokenVersion: 1,
        expiresAt: '2026-09-18T03:30:00.000Z',
      }),
    }),
  );
  const response = await fetch(`${baseUrl}/merchant/merchants/merchant-visible/claim-slots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerAccountId: 'customer-1',
      merchantReference: 'demo-order-1',
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    claimSlotId: 'claim-slot-1',
    token: 'claim-token-returned-once',
    tokenVersion: 1,
    expiresAt: '2026-09-18T03:30:00.000Z',
  });
});

test('reissues the expected token version for the same claim slot', async (t) => {
  let receivedExpectedTokenVersion: number | undefined;
  const baseUrl = await startFixture(
    t,
    () => 'merchant-owner-1',
    undefined,
    {
      requirePermission: async ({ merchantId }) => ({
        merchantId,
        role: 'OWNER',
        permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
      }),
    },
    claimSlotFixture({
      reissue: async ({ claimSlotId, expectedTokenVersion }) => {
        receivedExpectedTokenVersion = expectedTokenVersion;
        return {
          claimSlotId,
          token: 'replacement-claim-token',
          tokenVersion: 2,
          expiresAt: '2026-09-18T03:45:00.000Z',
        };
      },
    }),
  );
  const response = await fetch(
    `${baseUrl}/merchant/merchants/merchant-visible/claim-slots/claim-slot-1/reissue`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedTokenVersion: 1 }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(receivedExpectedTokenVersion, 1);
  assert.deepEqual(await response.json(), {
    claimSlotId: 'claim-slot-1',
    token: 'replacement-claim-token',
    tokenVersion: 2,
    expiresAt: '2026-09-18T03:45:00.000Z',
  });
});

test('redeems a claim token only for the authenticated customer account', async (t) => {
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    claimSlotFixture({
      redeem: async () => ({
        claimSlotId: 'claim-slot-1',
        merchantId: 'merchant-visible',
        status: 'CLAIMED',
        visit: {
          visitEventId: 'visit-event-1',
          campaignId: 'campaign-visible',
          businessDate: '2026-09-18',
          verificationLevel: 'MERCHANT_CONFIRMED',
          progressCounted: true,
          progressVisitCount: 1,
        },
        grantedRewards: [
          {
            entitlementId: 'entitlement-1',
            targetVisitCount: 1,
            status: 'GRANTED',
            claimExpiresAt: '2026-12-17T03:00:00.000Z',
          },
        ],
      }),
    }),
  );
  const response = await fetch(`${baseUrl}/claim-slots/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'claim-token-returned-once' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    claimSlotId: 'claim-slot-1',
    merchantId: 'merchant-visible',
    status: 'CLAIMED',
    visit: {
      visitEventId: 'visit-event-1',
      campaignId: 'campaign-visible',
      businessDate: '2026-09-18',
      verificationLevel: 'MERCHANT_CONFIRMED',
      progressCounted: true,
      progressVisitCount: 1,
    },
    grantedRewards: [
      {
        entitlementId: 'entitlement-1',
        targetVisitCount: 1,
        status: 'GRANTED',
        claimExpiresAt: '2026-12-17T03:00:00.000Z',
      },
    ],
  });
});

test('previews a claim token without consuming it or putting the token in the URL', async (t) => {
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    claimSlotFixture({
      preview: async () => ({
        claimSlotId: 'claim-slot-1',
        merchantId: 'merchant-visible',
        expiresAt: '2026-09-18T03:30:00.000Z',
        status: 'AVAILABLE',
      }),
    }),
  );
  const response = await fetch(`${baseUrl}/claim-slots/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'claim-token-kept-in-body' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    claimSlotId: 'claim-slot-1',
    merchantId: 'merchant-visible',
    expiresAt: '2026-09-18T03:30:00.000Z',
    status: 'AVAILABLE',
  });
});

test('returns an authenticated collection without exposing claim tokens or exact meal times', async (t) => {
  let receivedAccountId: string | undefined;
  const collection = {
    visits: [
      {
        visitEventId: 'visit-event-1',
        merchantId: 'merchant-visible',
        merchantName: '데모 식당',
        campaignId: 'campaign-visible',
        campaignTitle: '가을 방문 도감',
        businessDate: '2026-09-19',
        progressCounted: true,
        verificationLevel: 'MERCHANT_CONFIRMED' as const,
      },
    ],
    collectibles: [
      {
        entitlementId: 'entitlement-1',
        merchantId: 'merchant-visible',
        merchantName: '데모 식당',
        campaignId: 'campaign-visible',
        campaignTitle: '가을 방문 도감',
        targetVisitCount: 1 as const,
        displayName: '첫 방문 마스코트',
        appCollectibleStatus: 'COLLECTED' as const,
        mintJobId: null,
        recipient: null,
        nftStatus: 'NOT_REQUESTED' as const,
        nft: null,
      },
    ],
  };
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    undefined,
    {
      getCollection: async (accountId) => {
        receivedAccountId = accountId;
        return collection;
      },
    },
  );

  const response = await fetch(`${baseUrl}/collection`);

  assert.equal(response.status, 200);
  assert.equal(receivedAccountId, 'customer-1');
  assert.deepEqual(await response.json(), collection);
  assert.doesNotMatch(JSON.stringify(collection), /token|occurredAt/);
});

test('does not bypass an unconfigured collection boundary', async (t) => {
  const baseUrl = await startFixture(t, () => 'customer-1');
  const response = await fetch(`${baseUrl}/collection`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'COLLECTION_NOT_CONFIGURED' });
});

test('returns authenticated recommendations with stable reason codes', async (t) => {
  let receivedAccountId: string | undefined;
  const recommendations = [
    {
      merchantId: 'merchant-new',
      merchantName: '새 가게',
      roadAddress: '서울 노원구 새길 1',
      campaignId: 'campaign-new',
      campaignTitle: '새 가게 도감',
      enrollmentStatus: 'OPEN' as const,
      progressVisitCount: 0,
      demo: true,
      reasonCode: 'NEW_PLACE' as const,
      reasonText: '아직 방문하지 않은 동네 가게예요.',
      nextGoal: {
        targetVisitCount: 1 as const,
        displayName: '첫 잎새',
        remainingVisits: 1,
      },
    },
  ];
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    undefined,
    undefined,
    {
      listRecommendations: async (accountId) => {
        receivedAccountId = accountId;
        return recommendations;
      },
    },
  );

  const response = await fetch(`${baseUrl}/recommendations`);

  assert.equal(response.status, 200);
  assert.equal(receivedAccountId, 'customer-1');
  assert.deepEqual(await response.json(), { recommendations });
});

test('maps claim slot conflicts and expiration without exposing stored data', async (t) => {
  let failure: ClaimSlotErrorCode = 'CLAIM_SLOT_ALREADY_EXISTS';
  const fail = async () => {
    throw new ClaimSlotError(failure);
  };
  const baseUrl = await startFixture(
    t,
    () => 'account-1',
    undefined,
    {
      requirePermission: async ({ merchantId }) => ({
        merchantId,
        role: 'STAFF',
        permissions: ['VIEW_MERCHANT', 'CONFIRM_VISIT'],
      }),
    },
    { issue: fail, reissue: fail, redeem: fail, preview: fail },
  );

  const cases = [
    {
      code: 'CLAIM_SLOT_ALREADY_EXISTS' as const,
      expectedStatus: 409,
      url: '/merchant/merchants/merchant-visible/claim-slots',
      body: { customerAccountId: 'customer-1', merchantReference: 'demo-order-1' },
    },
    {
      code: 'CLAIM_SLOT_NOT_REISSUABLE' as const,
      expectedStatus: 409,
      url: '/merchant/merchants/merchant-visible/claim-slots/claim-slot-1/reissue',
      body: { expectedTokenVersion: 1 },
    },
    {
      code: 'CLAIM_TOKEN_UNAVAILABLE' as const,
      expectedStatus: 409,
      url: '/claim-slots/redeem',
      body: { token: 'unavailable-token' },
    },
    {
      code: 'CLAIM_TOKEN_EXPIRED' as const,
      expectedStatus: 410,
      url: '/claim-slots/redeem',
      body: { token: 'expired-token' },
    },
    {
      code: 'CLAIM_CAMPAIGN_UNAVAILABLE' as const,
      expectedStatus: 409,
      url: '/claim-slots/redeem',
      body: { token: 'campaign-unavailable-token' },
    },
  ];

  for (const scenario of cases) {
    failure = scenario.code;
    const response = await fetch(`${baseUrl}${scenario.url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(scenario.body ? { body: JSON.stringify(scenario.body) } : {}),
    });
    assert.equal(response.status, scenario.expectedStatus, scenario.code);
    assert.deepEqual(await response.json(), { code: scenario.code });
  }
});

test('requires an authenticated account boundary for wallet challenges', async (t) => {
  const baseUrl = await startFixture(t);
  const wallet = Wallet.createRandom();
  const response = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'ACCOUNT_REQUIRED' });
});

test('uses the authenticated account resolver instead of trusting a public client header', async (t) => {
  const baseUrl = await startFixture(t, () => 'authenticated-session-user');
  const wallet = Wallet.createRandom();
  const response = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });

  assert.equal(response.status, 201);
});

test('issues and verifies a signed wallet challenge through HTTP', async (t) => {
  const baseUrl = await startFixture(t);
  const wallet = Wallet.createRandom();
  const accountHeaders = {
    'content-type': 'application/json',
    'x-account-id': 'user-http-1',
  };

  const challengeResponse = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: accountHeaders,
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });
  assert.equal(challengeResponse.status, 201);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
  };

  const signature = await wallet.signMessage(challenge.message);
  const verifyResponse = await fetch(`${baseUrl}/wallet/verify`, {
    method: 'POST',
    headers: accountHeaders,
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
  });

  assert.equal(verifyResponse.status, 200);
  const verification = (await verifyResponse.json()) as {
    verifiedAddress: string;
    walletBindingId: string;
    bindingVersion: number;
    verifiedAt: string;
  };
  assert.equal(verification.verifiedAddress, wallet.address);
  assert.equal(typeof verification.walletBindingId, 'string');
  assert.equal(verification.bindingVersion, 1);

  const activeBindingResponse = await fetch(`${baseUrl}/wallets/active-binding`, {
    headers: { 'x-account-id': 'user-http-1' },
  });
  assert.equal(activeBindingResponse.status, 200);
  assert.deepEqual(await activeBindingResponse.json(), {
    binding: {
      bindingId: verification.walletBindingId,
      bindingVersion: 1,
      address: wallet.address,
      chainId: 84532,
      verifiedAt: verification.verifiedAt,
    },
  });

  const replayResponse = await fetch(`${baseUrl}/wallet/verify`, {
    method: 'POST',
    headers: accountHeaders,
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
  });
  assert.equal(replayResponse.status, 409);
  assert.deepEqual(await replayResponse.json(), { code: 'NONCE_ALREADY_USED' });
});

test('accepts a mint request without trusting recipient or series fields from the client', async (t) => {
  let received:
    | Parameters<MintRequestService['requestMint']>[0]
    | undefined;
  const result: MintRequestResult = {
    jobId: 'mint-job-1',
    status: 'QUEUED',
    chainId: 84532,
    recipient: '0x4000000000000000000000000000000000000004',
    nft: null,
    replayed: false,
  };
  const mintRequests: MintRequestService = {
    requestMint: async (input) => {
      received = input;
      return result;
    },
    getMintJob: async () => {
      throw new Error('unexpected get mint job call');
    },
  };
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    mintRequests,
  );

  const response = await fetch(
    `${baseUrl}/entitlements/20000000-0000-4000-8000-000000000001/mint`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'mint-request-1',
      },
      body: JSON.stringify({
        walletBindingId: '30000000-0000-4000-8000-000000000001',
        bindingVersion: 1,
        consentVersion: 'nft-mint-v1',
        recipient: '0x5000000000000000000000000000000000000005',
        seriesId: 'client-controlled-series',
        rewardKey: 'client-controlled-key',
      }),
    },
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), result);
  assert.deepEqual(received, {
    accountId: 'customer-1',
    entitlementId: '20000000-0000-4000-8000-000000000001',
    walletBindingId: '30000000-0000-4000-8000-000000000001',
    bindingVersion: 1,
    consentVersion: 'nft-mint-v1',
    idempotencyKey: 'mint-request-1',
  });
});

test('returns only the authenticated owner mint job', async (t) => {
  const view: MintJobView = {
    jobId: 'mint-job-1',
    status: 'QUEUED',
    chainId: 84532,
    recipient: '0x4000000000000000000000000000000000000004',
    walletBindingId: 'wallet-binding-1',
    bindingVersion: 1,
    nft: null,
  };
  let received: Parameters<MintRequestService['getMintJob']>[0] | undefined;
  const baseUrl = await startFixture(
    t,
    () => 'customer-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      requestMint: async () => {
        throw new Error('unexpected request mint call');
      },
      getMintJob: async (input) => {
        received = input;
        return view;
      },
    },
  );

  const response = await fetch(`${baseUrl}/mint-jobs/mint-job-1`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), view);
  assert.deepEqual(received, { accountId: 'customer-1', jobId: 'mint-job-1' });
});

test('requires an authenticated account boundary for campaign enrollment', async (t) => {
  const campaignEnrollments: CampaignEnrollmentService = {
    enroll: async () => {
      throw new Error('unexpected enroll call');
    },
  };
  const baseUrl = await startFixture(
    t,
    developmentHeaderAccountResolver,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    campaignEnrollments,
  );

  const response = await fetch(`${baseUrl}/campaigns/campaign-1/enrollments`, {
    method: 'POST',
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'ACCOUNT_REQUIRED' });
});

test('maps campaign enrollment errors without leaking capacity internals', async (t) => {
  let failure: CampaignEnrollmentErrorCode = 'CAMPAIGN_NOT_FOUND';
  const campaignEnrollments: CampaignEnrollmentService = {
    enroll: async () => {
      throw new CampaignEnrollmentError(failure);
    },
  };
  const baseUrl = await startFixture(
    t,
    () => 'account-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    campaignEnrollments,
  );

  const cases = [
    { code: 'CAMPAIGN_NOT_FOUND' as const, expectedStatus: 404 },
    { code: 'CAMPAIGN_NOT_AVAILABLE' as const, expectedStatus: 409 },
    { code: 'CAMPAIGN_FULL' as const, expectedStatus: 409 },
    { code: 'ACCOUNT_DELETED' as const, expectedStatus: 410 },
  ];

  for (const scenario of cases) {
    failure = scenario.code;
    const response = await fetch(`${baseUrl}/campaigns/campaign-1/enrollments`, {
      method: 'POST',
    });
    assert.equal(response.status, scenario.expectedStatus, scenario.code);
    assert.deepEqual(await response.json(), { code: scenario.code });
  }
});

test('returns 200 for an idempotent replay and 201 for a new campaign enrollment', async (t) => {
  let created = true;
  let received: Parameters<CampaignEnrollmentService['enroll']>[0] | undefined;
  const campaignEnrollments: CampaignEnrollmentService = {
    enroll: async (input) => {
      received = input;
      return {
        enrollmentId: 'enrollment-1',
        campaignId: input.campaignId,
        accountId: input.accountId,
        enrolledAt: '2026-09-20T03:00:00.000Z',
        created,
      };
    },
  };
  const baseUrl = await startFixture(
    t,
    () => 'account-1',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    campaignEnrollments,
  );

  const first = await fetch(`${baseUrl}/campaigns/campaign-1/enrollments`, { method: 'POST' });
  assert.equal(first.status, 201);
  assert.deepEqual(received, { campaignId: 'campaign-1', accountId: 'account-1' });

  created = false;
  const second = await fetch(`${baseUrl}/campaigns/campaign-1/enrollments`, { method: 'POST' });
  assert.equal(second.status, 200);
});

test('disconnects only the authenticated wallet binding version', async (t) => {
  const baseUrl = await startFixture(t, () => 'customer-1');
  const wallet = Wallet.createRandom();
  const challengeResponse = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });
  const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };
  const signature = await wallet.signMessage(challenge.message);
  const verificationResponse = await fetch(`${baseUrl}/wallet/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
  });
  const binding = (await verificationResponse.json()) as {
    walletBindingId: string;
    bindingVersion: number;
  };

  const response = await fetch(`${baseUrl}/wallets/${binding.walletBindingId}/binding`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bindingVersion: binding.bindingVersion }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'DISCONNECTED' });

  const active = await fetch(`${baseUrl}/wallets/active-binding`);
  assert.deepEqual(await active.json(), { binding: null });
});

test('D01 requires reauthentication, requests deletion, and invalidates wallet challenges', async (t) => {
  let received: Parameters<AccountDeletionService['requestDeletion']>[0] | undefined;
  let reauthenticatedAccount: string | undefined;
  const result = {
    requestId: '90000000-0000-4000-8000-000000000001',
    status: 'WAITING_FOR_MINT_FINALITY' as const,
    requestedAt: '2026-09-19T15:00:00.000Z',
    completedAt: null,
    cancelledMintJobs: 1,
    pendingMintJobs: 1,
    retainedFinalizedNfts: 1,
    replayed: false,
  };
  const baseUrl = await startFixture(
    t,
    () => 'customer-delete',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      requestDeletion: async (input) => {
        received = input;
        return result;
      },
    },
    async (accountId) => {
      reauthenticatedAccount = accountId;
    },
  );
  const wallet = Wallet.createRandom();
  const challengeResponse = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });
  const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };

  const response = await fetch(`${baseUrl}/account-deletion-requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), result);
  assert.equal(reauthenticatedAccount, 'customer-delete');
  assert.deepEqual(received, {
    accountId: 'customer-delete',
    confirmation: 'DELETE MY ACCOUNT',
  });

  const invalidated = await fetch(`${baseUrl}/wallet/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature: 'invalid-but-nonempty',
      currentAddress: wallet.address,
    }),
  });
  assert.equal(invalidated.status, 404);
  assert.deepEqual(await invalidated.json(), { code: 'CHALLENGE_NOT_FOUND' });
});
