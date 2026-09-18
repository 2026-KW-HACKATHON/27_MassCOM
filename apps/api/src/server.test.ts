import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { Wallet } from 'ethers';

import {
  createApiServer,
  developmentHeaderAccountResolver,
  type AccountResolver,
} from './server.js';
import { ClaimSlotError, type ClaimSlotErrorCode } from './claim-slot-service.js';
import { MerchantAccessError } from './merchant-access.js';
import type { MerchantCatalog } from './merchant-catalog.js';
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
  }): Promise<{ claimSlotId: string; merchantId: string; status: 'CLAIMED' }>;
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
  const verification = (await verifyResponse.json()) as { verifiedAddress: string };
  assert.equal(verification.verifiedAddress, wallet.address);

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
