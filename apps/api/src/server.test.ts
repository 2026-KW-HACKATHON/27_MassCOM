import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { test, type TestContext } from 'node:test';

import { Wallet } from 'ethers';

import * as serverModule from './server.js';

import type { AccountDeletionService } from './account-deletion.js';
import type { AccountDeletionIntakeService } from './account-deletion-intake.js';
import { AuthSessionError, type AuthSessionService } from './auth-session.js';
import { BadgeRewardError, type BadgeRewardErrorCode, type BadgeRewardService } from './badge-rewards.js';
import { GoogleIdTokenError } from './google-id-token.js';
import { CustomerIdentityError, type CustomerIdentityService } from './customer-identity.js';
import { WebAuthError, type WebAuthHandler } from './web-auth.js';
import {
  createApiServer,
  createBearerAccountResolver,
  createSessionReauthenticationGuard,
  developmentHeaderAccountResolver,
  renderClaimQr,
  resolveApiBindHost,
  resolveAuthMode,
  sessionTtlMs,
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
import { AdminError, type PostgresAdminService } from './postgres/admin.js';
import type { PostgresStaffRegistration } from './postgres/staff-registration.js';
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
  issue(input: {
    merchantId: string;
    customerIdentityToken: string;
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
    merchantName: string;
    campaignId: string;
    campaignTitle: string;
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

type AuthLoginLimiterFixture = {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
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
  authSessions?: AuthSessionService,
  authLoginLimiter?: AuthLoginLimiterFixture,
  trustProxyClientIp = false,
  webAuth?: WebAuthHandler,
  wwwEnabled = false,
  admin?: Pick<PostgresAdminService, 'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>,
  deletionIntake?: AccountDeletionIntakeService,
  staffRegistration?: Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>,
  customerIdentities?: CustomerIdentityService,
  badges?: BadgeRewardService,
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
    authSessions,
    authLoginLimiter,
    trustProxyClientIp,
    webAuth,
    wwwEnabled,
    customerIdentities,
    admin,
    deletionIntake,
    staffRegistration,
    badges,
  );

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind a TCP port');
  }

  return `http://127.0.0.1:${address.port}`;
}

async function webRequest(baseUrl: string, path: string, options: {
  host?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, baseUrl), {
      method: options.method ?? 'GET',
      headers: { Host: options.host ?? 'masscom.kr', ...options.headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
          else if (value !== undefined) headers.set(name, value);
        }
        const body = Buffer.concat(chunks);
        resolve(new Response(body.length ? body : null, {
          status: response.statusCode ?? 500, headers,
        }));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

test('serves health without exposing wallet data', async (t) => {
  const baseUrl = await startFixture(t);
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('web auth starts with a browser state cookie and callback returns only a scoped session cookie', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => ({ location: 'https://accounts.google.com/o/oauth2/v2/auth?state=state-1', state: 'state-1' }),
    complete: async (code, state, cookieState) => {
      assert.deepEqual([code, state, cookieState], ['one-time-code', 'state-1', 'state-1']);
      return { token: 'secret-web-token' };
    },
    resolveSession: async () => 'account-1',
    logout: async () => {},
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  const start = await webRequest(baseUrl, '/api/web/auth/start');
  assert.equal(start.status, 302);
  assert.match(start.headers.get('set-cookie') ?? '', /web_auth_state=state-1; Path=\/api\/web\/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax/);
  assert.match(start.headers.get('location') ?? '', /^https:\/\/accounts\.google\.com\//);

  const callback = await webRequest(baseUrl, '/api/web/auth/callback?code=one-time-code&state=state-1', {
    headers: { cookie: 'web_auth_state=state-1' },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/app/');
  assert.match(callback.headers.get('set-cookie') ?? '', /web_session=secret-web-token; Path=\/api\/web; HttpOnly; Secure; SameSite=Lax/);
  assert.doesNotMatch(callback.headers.get('location') ?? '', /one-time-code|secret-web-token/);
  assert.equal(callback.headers.get('cache-control'), 'no-store');
});

test('web collection uses only the web cookie and never exposes private data without it', async (t) => {
  const accounts: string[] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async (token) => {
      if (token !== 'valid-web-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'web-account';
    },
    logout: async () => {},
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, {
    getCollection: async (accountId) => {
      accounts.push(accountId);
      return { visits: [], collectibles: [] };
    },
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  assert.equal((await webRequest(baseUrl, '/api/web/collection')).status, 401);
  const response = await webRequest(baseUrl, '/api/web/collection', {
    headers: { cookie: 'web_session=valid-web-cookie' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { visits: [], collectibles: [] });
  assert.deepEqual(accounts, ['web-account']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('web logout rejects GET and missing or foreign Origin before revoking a cookie', async (t) => {
  const revoked: string[] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'account-1',
    logout: async (token) => { revoked.push(token); },
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  assert.equal((await webRequest(baseUrl, '/api/web/logout')).status, 405);
  assert.equal((await webRequest(baseUrl, '/api/web/logout', { method: 'POST', headers: { cookie: 'web_session=token' } })).status, 403);
  assert.equal((await webRequest(baseUrl, '/api/web/logout', {
    method: 'POST', headers: { origin: 'https://evil.example', cookie: 'web_session=token' },
  })).status, 403);
  assert.deepEqual(revoked, []);
  const response = await webRequest(baseUrl, '/api/web/logout', {
    method: 'POST', headers: { origin: 'https://masscom.kr', cookie: 'web_session=token' },
  });
  assert.equal(response.status, 204);
  assert.deepEqual(revoked, ['token']);
  assert.match(response.headers.get('set-cookie') ?? '', /web_session=; Path=\/api\/web; Max-Age=0/);
});

test('web deletion intake accepts only same-origin JSON with the host-bound session', async (t) => {
  const requested: string[] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('unused'); },
    complete: async () => { throw new Error('unused'); },
    resolveSession: async (token, origin) => {
      if (token !== 'valid-cookie' || origin !== 'https://masscom.kr') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'session-account';
    },
    logout: async () => {},
  };
  const intake: AccountDeletionIntakeService = {
    request: async (accountId) => { requested.push(accountId); return { status: 'REQUESTED' }; },
  };
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, { requestDeletion: async () => { throw new Error('must not delete'); } },
    undefined, undefined, undefined, undefined, false, webAuth, true, undefined, intake);
  const path = '/api/web/account-deletion-intake';
  assert.equal((await webRequest(base, path)).status, 405);
  for (const headers of [
    { cookie: 'web_session=valid-cookie', 'content-type': 'application/json' },
    { cookie: 'web_session=valid-cookie', origin: 'https://evil.example', 'content-type': 'application/json' },
    { cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr', 'content-type': 'text/plain' },
  ]) {
    assert.equal((await webRequest(base, path, { method: 'POST', headers })).status, 403);
  }
  assert.equal((await webRequest(base, path, { method: 'POST', headers: {
    origin: 'https://masscom.kr', 'content-type': 'application/json',
  } })).status, 401);
  assert.equal((await webRequest(base, path, { host: 'www.masscom.kr', method: 'POST', headers: {
    origin: 'https://www.masscom.kr', cookie: 'web_session=valid-cookie', 'content-type': 'application/json',
  } })).status, 401);
  assert.deepEqual(requested, []);
  const response = await webRequest(base, path, { method: 'POST', headers: {
    origin: 'https://masscom.kr', cookie: 'web_session=valid-cookie', 'content-type': 'application/json',
  }, body: JSON.stringify({ accountId: 'different-account' }) });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'REQUESTED' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(requested, ['session-account']);
});

test('deletion Google sign-in returns to a fixed path', async (t) => {
  const destinations: (string | undefined)[] = [];
  const webAuth: WebAuthHandler = {
    start: async (_origin, returnTo) => {
      destinations.push(returnTo);
      return { location: 'https://accounts.google.com/', state: 'deletion-state' };
    },
    complete: async () => ({ token: 'cookie', returnTo: '/account-deletion' }),
    resolveSession: async () => 'account-1', logout: async () => {},
  };
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  const started = await webRequest(base, '/api/web/auth/start?returnTo=account-deletion&next=https://evil.example');
  assert.equal(started.status, 302);
  assert.deepEqual(destinations, ['/account-deletion']);
  const callback = await webRequest(base, '/api/web/auth/callback?code=once&state=deletion-state', {
    headers: { cookie: 'web_auth_state=deletion-state' },
  });
  assert.equal(callback.headers.get('location'), '/account-deletion');
});

test('admin API uses only the host-bound web cookie and rejects unauthorized, foreign-origin, and non-JSON writes', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => ({ location: 'https://accounts.google.com/', state: 'state' }),
    complete: async () => ({ token: 'token' }),
    resolveSession: async token => {
      if (token !== 'valid-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'account-1';
    },
    logout: async () => {},
  };
  let writes = 0;
  const admin = {
    isAdmin: async () => true,
    listMerchants: async () => [],
    createMerchant: async () => { writes += 1; throw new Error('unexpected write'); },
    updateMerchant: async () => { writes += 1; throw new Error('unexpected write'); },
    hideMerchant: async () => { writes += 1; throw new Error('unexpected write'); },
  } as unknown as Pick<PostgresAdminService, 'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  assert.equal((await webRequest(base, '/api/web/admin/merchants')).status, 401);
  assert.equal((await webRequest(base, '/api/web/admin/merchants', { headers: { authorization: 'Bearer valid-cookie' } })).status, 401);
  assert.equal((await webRequest(base, '/api/web/admin/merchants', { headers: { cookie: 'web_session=valid-cookie' } })).status, 200);
  assert.equal((await webRequest(base, '/api/web/admin/merchants', {
    host: 'api.masscom.kr', headers: { cookie: 'web_session=valid-cookie' },
  })).status, 403);
  for (const headers of [
    { cookie: 'web_session=valid-cookie', 'content-type': 'application/json' },
    { cookie: 'web_session=valid-cookie', origin: 'https://evil.example', 'content-type': 'application/json' },
    { cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr', 'content-type': 'text/plain' },
  ]) {
    const response = await webRequest(base, '/api/web/admin/merchants', {
      method: 'POST', headers,
    });
    assert.equal(response.status, 403);
  }
  assert.equal(writes, 0);
  const denied = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    { ...admin, isAdmin: async () => false });
  assert.equal((await webRequest(denied, '/api/web/admin/merchants', {
    headers: { cookie: 'web_session=valid-cookie' },
  })).status, 403);
});

test('admin operations status requires the host-bound admin session and returns only counts', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (token !== 'valid-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'admin-account';
    },
    logout: async () => {},
  };
  let reads = 0;
  const summary = { merchants: [{ id: 'real-1', name: '실제 점포', status: 'ACTIVE',
    claims: { active: 1, expired: 2, claimed: 3 }, visits: 4, rewards: 1,
    mintJobs: [{ status: 'RETRYABLE', count: 1 }], mintFailures: [{ code: 'RPC_TIMEOUT', count: 1 }] }] };
  const admin = {
    isAdmin: async () => true,
    operationsStatus: async () => { reads += 1; return summary; },
  } as unknown as Pick<PostgresAdminService,
    'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  const path = '/api/web/admin/operations-status';
  assert.equal((await webRequest(base, path)).status, 401);
  assert.equal((await webRequest(base, path, { host: 'api.masscom.kr',
    headers: { cookie: 'web_session=valid-cookie' } })).status, 403);
  const response = await webRequest(base, path, { headers: { cookie: 'web_session=valid-cookie' } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), summary);
  assert.equal(reads, 1);
  const denied = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    { ...admin, isAdmin: async () => false });
  assert.equal((await webRequest(denied, path, { headers: { cookie: 'web_session=valid-cookie' } })).status, 403);
  assert.equal(reads, 1);
});

test('admin Google sign-in returns to the fixed admin path without a caller-controlled redirect', async (t) => {
  const destinations: (string | undefined)[] = [];
  const webAuth: WebAuthHandler = {
    start: async (_origin, returnTo) => {
      destinations.push(returnTo);
      return { location: 'https://accounts.google.com/', state: 'admin-state' };
    },
    complete: async () => ({ token: 'admin-cookie', returnTo: '/admin/' }),
    resolveSession: async () => 'account-1', logout: async () => {},
  };
  const admin = { isAdmin: async () => true } as unknown as Pick<PostgresAdminService,
    'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  const start = await webRequest(base, '/api/web/admin/auth/start?returnTo=https://evil.example');
  assert.equal(start.status, 302);
  assert.deepEqual(destinations, ['/admin/']);
  const callback = await webRequest(base, '/api/web/auth/callback?code=once&state=admin-state', {
    headers: { cookie: 'web_auth_state=admin-state' },
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), '/admin/');
});

test('authenticated admin API accepts menu and hours without changing the merchant version contract', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'admin-account', logout: async () => {},
  };
  const writes: unknown[][] = [];
  const admin = {
    isAdmin: async () => true,
    createMerchant: async (...args: unknown[]) => { writes.push(['create', ...args]); return { id: 'real-1' }; },
    updateMerchant: async (...args: unknown[]) => { writes.push(['update', ...args]); return { id: 'real-1' }; },
  } as unknown as Pick<PostgresAdminService,
    'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  const headers = { cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  const input = { name: '실제 점포', story: '', roadAddress: '서울', minimumSpendWon: 0,
    menuItems: [{ name: '국수', priceWon: 7000 }], businessHours: '월–금 10:00–18:00' };
  const created = await webRequest(base, '/api/web/admin/merchants', {
    method: 'POST', headers, body: JSON.stringify(input),
  });
  assert.equal(created.status, 201);
  const updated = await webRequest(base, '/api/web/admin/merchants/real-1', {
    method: 'PATCH', headers, body: JSON.stringify({ ...input, expectedVersion: 3 }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(writes, [
    ['create', 'admin-account', input],
    ['update', 'admin-account', 'real-1', 3, input],
  ]);
});

test('admin campaign draft remains private and requires the web administrator session', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); }, complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'admin-account', logout: async () => {},
  };
  const writes: unknown[][] = [];
  const draft = { id: 'draft-1', merchantId: 'real-1', merchantName: '실제 점포', title: '첫 탐험',
    startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
    enrollmentCapacity: 15, rewardGoals: [
      { targetVisitCount: 1, displayName: '첫 방문' },
      { targetVisitCount: 3, displayName: '세 번째 방문' },
      { targetVisitCount: 5, displayName: '다섯 번째 방문' },
    ], status: 'DRAFT', public: false };
  const admin = { isAdmin: async () => true,
    listCampaignDrafts: async () => [draft],
    createCampaignDraft: async (...args: unknown[]) => { writes.push(args); return draft; },
  } as unknown as PostgresAdminService;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  const path = '/api/web/admin/campaign-drafts';
  assert.equal((await webRequest(base, path)).status, 401);
  const listed = await webRequest(base, path, { headers: { cookie: 'web_session=valid-cookie' } });
  assert.deepEqual(await listed.json(), { drafts: [draft] });
  const body = { merchantId: 'real-1', title: '첫 탐험', startsAt: draft.startsAt,
    endsAt: draft.endsAt, enrollmentCapacity: 15, rewardGoals: draft.rewardGoals };
  const headers = { cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  assert.equal((await webRequest(base, path, { method: 'POST',
    headers: { ...headers, origin: 'https://other.example' }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await webRequest(base, path, { method: 'POST', headers,
    body: JSON.stringify({ ...body, is_public: true }) })).status, 400);
  const created = await webRequest(base, path, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { draft });
  assert.deepEqual(writes, [['admin-account', body]]);
  const denied = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    { ...admin, isAdmin: async () => false } as unknown as PostgresAdminService);
  assert.equal((await webRequest(denied, path, { headers: { cookie: 'web_session=valid-cookie' } })).status, 403);
  assert.equal((await webRequest(denied, path, { method: 'POST', headers, body: JSON.stringify(body) })).status, 403);
  assert.equal(writes.length, 1);
});

test('merchant registration uses host-bound web cookie and rejects foreign-origin writes', async (t) => {
  const returns: (string | undefined)[] = [];
  const webAuth: WebAuthHandler = {
    start: async (_origin, returnTo) => {
      returns.push(returnTo);
      return { location: 'https://accounts.google.com/', state: 'merchant-state' };
    },
    complete: async () => ({ token: 'merchant-cookie', returnTo: '/merchant/' }),
    resolveSession: async token => {
      if (token !== 'merchant-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'staff-account';
    },
    logout: async () => {},
  };
  let writes = 0;
  const staff = {
    mine: async () => [], eligible: async () => [{ id: 'real-merchant', name: '실제 점포' }],
    request: async (accountId: string, merchantId: string) => {
      assert.equal(accountId, 'staff-account');
      assert.equal(merchantId, 'real-merchant');
      writes += 1;
      return { requestId: 'request-id', code: '1234567890123456789012', expiresAt: new Date().toISOString() };
    },
  } as unknown as Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    undefined, undefined, staff);
  const start = await webRequest(base, '/api/web/merchant/auth/start?returnTo=https://evil.example');
  assert.equal(start.status, 302);
  assert.deepEqual(returns, ['/merchant/']);
  const callback = await webRequest(base, '/api/web/auth/callback?code=once&state=merchant-state', {
    headers: { cookie: 'web_auth_state=merchant-state' },
  });
  assert.equal(callback.headers.get('location'), '/merchant/');
  assert.equal((await webRequest(base, '/api/web/merchant/me')).status, 401);
  assert.equal((await webRequest(base, '/api/web/merchant/me', {
    headers: { cookie: 'web_session=merchant-cookie' }, host: 'api.masscom.kr',
  })).status, 403);
  for (const headers of [
    { cookie: 'web_session=merchant-cookie', 'content-type': 'application/json' },
    { cookie: 'web_session=merchant-cookie', origin: 'https://evil.example', 'content-type': 'application/json' },
    { cookie: 'web_session=merchant-cookie', origin: 'https://masscom.kr', 'content-type': 'text/plain' },
  ]) {
    assert.equal((await webRequest(base, '/api/web/merchant/registration-requests', {
      method: 'POST', headers, body: '{"merchantId":"real-merchant"}',
    })).status, 403);
  }
  assert.equal(writes, 0);
  const issued = await webRequest(base, '/api/web/merchant/registration-requests', {
    method: 'POST', headers: { cookie: 'web_session=merchant-cookie', origin: 'https://masscom.kr',
      'content-type': 'application/json' }, body: '{"merchantId":"real-merchant"}',
  });
  assert.equal(issued.status, 201);
  assert.equal(writes, 1);
});

test('merchant web resolves a customer QR and issues a confirmed claim without exposing a replay token', async (t) => {
  const calls: unknown[][] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); }, complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (token !== 'staff-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'staff-account';
    }, logout: async () => {},
  };
  const staff = { mine: async () => [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] } as unknown as
    Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>;
  const access: MerchantAccessFixture = { requirePermission: async input => {
    calls.push(['permission', input]);
    return { merchantId: input.merchantId, role: 'STAFF', permissions: ['CONFIRM_VISIT'] };
  } };
  const identities = { resolve: async input => {
    calls.push(['resolve', input]);
    return { expiresAt: '2026-09-28T12:00:00.000Z' };
  } } as CustomerIdentityService;
  let issued = false;
  const claims = claimSlotFixture({ issue: (async input => {
    calls.push(['issue', input]);
    if (issued) return { claimSlotId: 'slot-1', tokenVersion: 1,
      expiresAt: '2026-09-28T12:10:00.000Z', replayed: true };
    issued = true;
    return { claimSlotId: 'slot-1', token: 'private-claim-token', tokenVersion: 1,
      expiresAt: '2026-09-28T12:10:00.000Z' };
  }) as ClaimSlotFixture['issue'], reissue: async input => {
    calls.push(['reissue', input]);
    return { claimSlotId: input.claimSlotId, token: 'replacement-token', tokenVersion: 2,
      expiresAt: '2026-09-28T12:20:00.000Z' };
  } });
  const base = await startFixture(t, undefined, undefined, access, claims, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false,
    webAuth, false, undefined, undefined, staff, identities);
  const headers = { cookie: 'web_session=staff-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  const prefix = '/api/web/merchant/merchants/real-merchant';
  const resolved = await webRequest(base, `${prefix}/customer-identities/resolve`, {
    method: 'POST', headers, body: JSON.stringify({ customerIdentityToken: 'customer-qr' }),
  });
  assert.equal(resolved.status, 200);
  assert.deepEqual(await resolved.json(), { expiresAt: '2026-09-28T12:00:00.000Z' });
  const body = JSON.stringify({ customerIdentityToken: 'customer-qr', merchantReference: 'sale-1', useConfirmed: true });
  const first = await webRequest(base, `${prefix}/claim-slots`, { method: 'POST', headers, body });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.token, 'private-claim-token');
  assert.match(firstBody.qrSvgDataUrl, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(firstBody.qrSvgDataUrl.split(',')[1], 'base64').toString(), /^<svg/);
  const replay = await webRequest(base, `${prefix}/claim-slots`, { method: 'POST', headers, body });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { claimSlotId: 'slot-1', tokenVersion: 1,
    expiresAt: '2026-09-28T12:10:00.000Z', replayed: true });
  const reissued = await webRequest(base, `${prefix}/claim-slots/slot-1/reissue`, {
    method: 'POST', headers, body: JSON.stringify({ expectedTokenVersion: 1 }),
  });
  assert.equal(reissued.status, 200);
  const reissuedBody = await reissued.json();
  assert.equal(reissuedBody.token, 'replacement-token');
  assert.equal(reissuedBody.tokenVersion, 2);
  assert.match(reissuedBody.qrSvgDataUrl, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(calls, [
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['resolve', { token: 'customer-qr', merchantId: 'real-merchant', staffAccountId: 'staff-account' }],
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['issue', { merchantId: 'real-merchant', customerIdentityToken: 'customer-qr',
      merchantReference: 'sale-1', createdByAccountId: 'staff-account' }],
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['issue', { merchantId: 'real-merchant', customerIdentityToken: 'customer-qr',
      merchantReference: 'sale-1', createdByAccountId: 'staff-account' }],
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['reissue', { merchantId: 'real-merchant', claimSlotId: 'slot-1', expectedTokenVersion: 1,
      requestedByAccountId: 'staff-account' }],
  ]);
});

test('a QR rendering failure preserves the issued token path without hiding the failure', async () => {
  assert.deepEqual(await renderClaimQr('one-time-token', async () => { throw new Error('renderer failed'); }),
    { qrRenderFailed: true });
});

test('merchant web rejects invalid QR, foreign origin, missing confirmation and non-real merchant', async (t) => {
  let allowed = true;
  let real = true;
  let issueCalls = 0;
  let reissueCalls = 0;
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); }, complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (token !== 'staff-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'staff-account';
    }, logout: async () => {},
  };
  const access: MerchantAccessFixture = { requirePermission: async input => {
    if (!allowed) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    return { merchantId: input.merchantId, role: 'STAFF', permissions: ['CONFIRM_VISIT'] };
  } };
  const staff = { mine: async () => real ? [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] : [] } as unknown as
    Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>;
  const identities = { resolve: async ({ token }: { token: string }) => {
    if (token === 'expired') throw new CustomerIdentityError('CUSTOMER_IDENTITY_EXPIRED');
    throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
  } } as unknown as CustomerIdentityService;
  const claims = claimSlotFixture({ issue: (async () => {
    issueCalls += 1;
    throw new Error('unexpected issue');
  }) as ClaimSlotFixture['issue'], reissue: async () => {
    reissueCalls += 1;
    throw new Error('unexpected reissue');
  } });
  const base = await startFixture(t, undefined, undefined, access, claims, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false,
    webAuth, false, undefined, undefined, staff, identities);
  const prefix = '/api/web/merchant/merchants/real-merchant';
  const headers = { cookie: 'web_session=staff-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  const post = (suffix: string, body: object, customHeaders = headers, host = 'masscom.kr') =>
    webRequest(base, `${prefix}/${suffix}`, { method: 'POST', headers: customHeaders,
      host, body: JSON.stringify(body) });
  for (const [token, status, code] of [
    ['missing', 409, 'CUSTOMER_IDENTITY_UNAVAILABLE'],
    ['expired', 410, 'CUSTOMER_IDENTITY_EXPIRED'],
    ['other-account', 409, 'CUSTOMER_IDENTITY_UNAVAILABLE'],
  ] as const) {
    const response = await post('customer-identities/resolve', { customerIdentityToken: token });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
  }
  assert.equal((await post('claim-slots', { customerIdentityToken: 'qr', merchantReference: 'sale-1' })).status, 400);
  assert.equal((await post('claim-slots', { customerAccountId: 'forged', customerIdentityToken: 'qr',
    merchantReference: 'sale-1', useConfirmed: true })).status, 400);
  assert.equal((await post('customer-identities/resolve', { customerAccountId: 'forged', customerIdentityToken: 'qr' })).status, 400);
  assert.equal((await post('claim-slots', { customerIdentityToken: 'qr', merchantReference: 'sale-1',
    useConfirmed: true }, { ...headers, origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('customer-identities/resolve', { customerIdentityToken: 'qr' }, headers,
    'api.masscom.kr')).status, 403);
  assert.equal((await post('claim-slots', { customerIdentityToken: 'qr', merchantReference: 'sale-1',
    useConfirmed: true }, { ...headers, cookie: '' })).status, 401);
  const reissuePath = 'claim-slots/slot-1/reissue';
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1 }, { ...headers, cookie: '' })).status, 401);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1 },
    { ...headers, origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1 }, headers, 'api.masscom.kr')).status, 403);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 0 })).status, 400);
  assert.equal((await post(reissuePath, { expectedTokenVersion: '1' })).status, 400);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1, requestedByAccountId: 'forged' })).status, 400);
  allowed = false;
  assert.equal((await post('customer-identities/resolve', { customerIdentityToken: 'qr' })).status, 403);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1 })).status, 403);
  allowed = true;
  real = false;
  assert.equal((await post('claim-slots', { customerIdentityToken: 'qr', merchantReference: 'sale-1',
    useConfirmed: true })).status, 403);
  assert.equal((await post(reissuePath, { expectedTokenVersion: 1 })).status, 403);
  assert.equal(issueCalls, 0);
  assert.equal(reissueCalls, 0);
});

test('admin staff approval and revoke derive the actor from the web session', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => ({ location: 'https://accounts.google.com/', state: 'state' }),
    complete: async () => ({ token: 'token' }),
    resolveSession: async () => 'admin-account', logout: async () => {},
  };
  const calls: unknown[][] = [];
  const staff = {
    approve: async (...args: unknown[]) => { calls.push(['approve', ...args]); },
    revoke: async (...args: unknown[]) => { calls.push(['revoke', ...args]); },
  } as unknown as Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>;
  const admin = { isAdmin: async () => true } as unknown as Pick<PostgresAdminService,
    'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    admin, undefined, staff);
  const headers = { cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  const approved = await webRequest(base, '/api/web/admin/merchants/real-merchant/staff', {
    method: 'POST', headers, body: '{"code":"1234567890123456789012","accountId":"forged"}',
  });
  assert.equal(approved.status, 200);
  const revoked = await webRequest(base, '/api/web/admin/merchants/real-merchant/staff/staff-account/revoke', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(revoked.status, 200);
  assert.deepEqual(calls, [
    ['approve', 'admin-account', 'real-merchant', '1234567890123456789012'],
    ['revoke', 'admin-account', 'real-merchant', 'staff-account'],
  ]);
});

test('admin hide returns a distinct 409 while valid QR claims are pending', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'admin-account', logout: async () => {},
  };
  const admin = {
    isAdmin: async () => true,
    hideMerchant: async () => { throw new AdminError('ADMIN_PENDING_CLAIMS'); },
  } as unknown as Pick<PostgresAdminService,
    'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'>;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false, admin);
  const response = await webRequest(base, '/api/web/admin/merchants/merchant-1/hide', {
    method: 'POST', headers: {
      cookie: 'web_session=valid-cookie', origin: 'https://masscom.kr', 'content-type': 'application/json',
    }, body: '{"expectedVersion":1}',
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { code: 'ADMIN_PENDING_CLAIMS' });
});

test('web login start obeys the existing per-client login limiter before storing a state', async (t) => {
  let started = 0;
  const webAuth: WebAuthHandler = {
    start: async () => {
      started += 1;
      return { location: 'https://accounts.google.com/o/oauth2/v2/auth', state: 'state-1' };
    },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'account-1',
    logout: async () => {},
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined,
    { consume: () => ({ allowed: false, retryAfterSeconds: 20 }) }, false, webAuth);
  const response = await webRequest(baseUrl, '/api/web/auth/start');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '20');
  assert.equal(started, 0);
});

test('web callback maps provider outage to a retryable 503 without echoing the code', async (t) => {
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async () => { throw new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE'); },
    resolveSession: async () => 'account-1',
    logout: async () => {},
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  const response = await webRequest(baseUrl, '/api/web/auth/callback?code=secret-code&state=state-1', {
    headers: { cookie: 'web_auth_state=state-1' },
  });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.match(body, /WEB_AUTH_UPSTREAM_UNAVAILABLE/);
  assert.doesNotMatch(body, /secret-code/);
});

test('www web routes use only the exact Host and matching logout Origin', async (t) => {
  const calls: string[] = [];
  const webAuth: WebAuthHandler = {
    start: async (origin) => {
      calls.push(`start:${origin}`);
      return { location: 'https://accounts.google.com/o/oauth2/v2/auth', state: 'www-state' };
    },
    complete: async (_code, _state, _cookieState, origin) => {
      calls.push(`complete:${origin}`);
      return { token: 'www-token' };
    },
    resolveSession: async (_token, origin) => {
      calls.push(`collection:${origin}`);
      return 'account-1';
    },
    logout: async (_token, origin) => { calls.push(`logout:${origin}`); },
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, {
    getCollection: async () => ({ visits: [], collectibles: [] }),
  }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, true);
  const wwwStart = await webRequest(baseUrl, '/api/web/auth/start', { host: 'www.masscom.kr' });
  assert.equal(wwwStart.status, 302);
  assert.match(wwwStart.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/start', { host: 'api.masscom.kr' })).status, 403);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/start', { host: 'www.masscom.kr:8443' })).status, 403);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/start', {
    headers: { 'X-Forwarded-Host': 'www.masscom.kr' },
  })).status, 302);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/callback?code=code&state=www-state', {
    host: 'www.masscom.kr', headers: { cookie: 'web_auth_state=www-state' },
  })).status, 303);
  assert.equal((await webRequest(baseUrl, '/api/web/collection', {
    host: 'www.masscom.kr', headers: { cookie: 'web_session=www-token' },
  })).status, 200);
  assert.equal((await webRequest(baseUrl, '/api/web/logout', {
    host: 'www.masscom.kr', method: 'POST',
    headers: { origin: 'https://masscom.kr', cookie: 'web_session=www-token' },
  })).status, 403);
  assert.equal((await webRequest(baseUrl, '/api/web/logout', {
    host: 'www.masscom.kr', method: 'POST',
    headers: { origin: 'https://www.masscom.kr', cookie: 'web_session=www-token' },
  })).status, 204);
  assert.deepEqual(calls, [
    'start:https://www.masscom.kr', 'start:https://masscom.kr',
    'complete:https://www.masscom.kr', 'collection:https://www.masscom.kr',
    'logout:https://www.masscom.kr',
  ]);
});

test('www web auth remains closed when its runtime flag is off', async (t) => {
  let starts = 0;
  const webAuth: WebAuthHandler = {
    start: async () => { starts += 1; return { location: 'https://accounts.google.com/', state: 'apex-state' }; },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async () => 'account-1',
    logout: async () => {},
  };
  const baseUrl = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/start', { host: 'www.masscom.kr' })).status, 403);
  assert.equal(starts, 0);
  assert.equal((await webRequest(baseUrl, '/api/web/auth/start', { host: 'masscom.kr' })).status, 302);
  assert.equal(starts, 1);
});

test('D02 every JSON response forbids caching so one account never receives another account\'s data', async (t) => {
  const baseUrl = await startFixture(t, () => 'account-1');

  for (const [method, path] of [
    ['GET', '/health'],
    ['GET', '/collection'],
    ['GET', '/recommendations'],
    ['GET', '/no-such-route'],
  ] as const) {
    const response = await fetch(`${baseUrl}${path}`, { method });
    assert.equal(response.headers.get('cache-control'), 'no-store', `${method} ${path}`);
  }
});

test('lists public merchants without requiring login or a wallet', async (t) => {
  const merchant = {
    id: 'merchant-demo-noodle',
    name: '데모 국수집',
    story: '실제 협약 점포가 아닌 개발용 예시입니다.',
    roadAddress: '서울 노원구 데모로 1',
    minimumSpendWon: 10_000,
    menuItems: [],
    businessHours: '',
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
    developmentHeaderAccountResolver,
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
    headers: { 'content-type': 'application/json', 'x-account-id': 'merchant-staff-1' },
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
        merchantName: '데모 식당',
        campaignTitle: '가을 방문 도감',
        status: 'CLAIMED',
        replayed: false,
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
    merchantName: '데모 식당',
    campaignTitle: '가을 방문 도감',
    status: 'CLAIMED',
    replayed: false,
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
        merchantName: '데모 식당',
        campaignId: 'campaign-visible',
        campaignTitle: '가을 방문 도감',
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
    merchantName: '데모 식당',
    campaignId: 'campaign-visible',
    campaignTitle: '가을 방문 도감',
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
    developmentHeaderAccountResolver,
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
      headers: { 'content-type': 'application/json', 'x-account-id': 'account-1' },
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

test('rejects a malformed wallet signature without logging it', async (t) => {
  const captured: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  t.after(() => {
    console.error = originalConsoleError;
  });

  const baseUrl = await startFixture(t, () => 'wallet-log-boundary-user');
  const wallet = Wallet.createRandom();
  const challengeResponse = await fetch(`${baseUrl}/wallet/challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, chainId: 84532 }),
  });
  assert.equal(challengeResponse.status, 201);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    message: string;
  };
  const signature = `0x${'ab'.repeat(66)}`;

  const response = await fetch(`${baseUrl}/wallet/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'SIGNER_MISMATCH' });
  assert.equal(JSON.stringify(captured).includes(signature), false);
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

test('malformed percent-encoding in a path parameter is a 400, not a server error', async (t) => {
  const campaignEnrollments: CampaignEnrollmentService = {
    async enroll() {
      throw new Error('must not be reached');
    },
  };
  const unreachableMintRequests = new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('must not be reached');
      },
    },
  ) as MintRequestService;
  const unreachable = <T>() =>
    new Proxy(
      {},
      {
        get: () => async () => {
          throw new Error('must not be reached');
        },
      },
    ) as T;
  const baseUrl = await startFixture(
    t,
    () => 'account-1',
    undefined,
    unreachable<MerchantAccessFixture>(),
    unreachable<ClaimSlotFixture>(),
    undefined,
    undefined,
    unreachableMintRequests,
    undefined,
    undefined,
    campaignEnrollments,
  );

  for (const [method, path] of [
    ['POST', '/campaigns/%E0%A4%A/enrollments'],
    ['POST', '/entitlements/%E0%A4%A/mint'],
    ['GET', '/mint-jobs/%E0%A4%A'],
    ['DELETE', '/wallets/%E0%A4%A/binding'],
    ['GET', '/merchant/merchants/%E0%A4%A/context'],
    ['POST', '/merchant/merchants/%E0%A4%A/claim-slots'],
    ['POST', '/merchant/merchants/%E0%A4%A/claim-slots/slot-1/reissue'],
  ] as const) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(method !== 'GET'
        ? { headers: { 'content-type': 'application/json' }, body: '{}' }
        : {}),
    });
    assert.equal(response.status, 400, `${method} ${path}`);
    assert.deepEqual(await response.json(), { code: 'INVALID_PATH_PARAMETER' });
  }
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

function authSessionFixture(overrides: Partial<AuthSessionService> = {}): AuthSessionService {
  return {
    signInWithGoogle: async () => {
      throw new Error('unexpected sign-in call');
    },
    resolve: async () => {
      throw new Error('unexpected resolve call');
    },
    logout: async () => {
      throw new Error('unexpected logout call');
    },
    reauthenticate: async () => {
      throw new Error('unexpected reauthenticate call');
    },
    assertRecentlyAuthenticated: async () => {
      throw new Error('unexpected recency check call');
    },
    ...overrides,
  };
}

test('D24 signs in with a Google ID token and returns the session once', async (t) => {
  let received: string | undefined;
  const sessions = authSessionFixture({
    signInWithGoogle: async (idToken) => {
      received = idToken;
      return {
        sessionToken: 'session-returned-once',
        accountId: 'acct_11111111-1111-4111-8111-111111111111',
        expiresAt: '2026-10-21T00:00:00.000Z',
      };
    },
  });
  const baseUrl = await startFixture(
    t,
    () => 'unused-account',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sessions,
  );

  const response = await fetch(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'google-id-token-value' }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    sessionToken: 'session-returned-once',
    accountId: 'acct_11111111-1111-4111-8111-111111111111',
    expiresAt: '2026-10-21T00:00:00.000Z',
  });
  assert.equal(received, 'google-id-token-value');
});

test('D24 rejects an unverifiable Google ID token with a fixed code', async (t) => {
  const sessions = authSessionFixture({
    signInWithGoogle: async () => {
      throw new GoogleIdTokenError('ID_TOKEN_AUDIENCE_MISMATCH');
    },
  });
  const baseUrl = await startFixture(
    t,
    () => 'unused-account',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sessions,
  );

  const response = await fetch(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'forged-id-token-value' }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'ID_TOKEN_AUDIENCE_MISMATCH' });
});

test('showcase uninvited Google subject is denied without issuing a session', async (t) => {
  const sessions = authSessionFixture({
    signInWithGoogle: async () => {
      throw new AuthSessionError('INVITE_REQUIRED');
    },
  });
  const baseUrl = await startFixture(
    t, () => 'unused-account', undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, sessions,
  );
  const response = await fetch(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'signed-but-uninvited' }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: 'INVITE_REQUIRED' });
});

test('D24 rate limits Google sign-in before invoking token verification', async (t) => {
  let signInCalls = 0;
  let limiterCalls = 0;
  const sessions = authSessionFixture({
    signInWithGoogle: async () => {
      signInCalls += 1;
      return {
        sessionToken: 'session-rate-limit',
        accountId: 'acct_rate_limit',
        expiresAt: '2026-10-21T00:00:00.000Z',
      };
    },
  });
  const baseUrl = await startFixture(
    t,
    () => 'unused-account',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sessions,
    {
      consume: () => {
        limiterCalls += 1;
        return limiterCalls === 1
          ? { allowed: true, retryAfterSeconds: 0 }
          : { allowed: false, retryAfterSeconds: 60 };
      },
    },
  );

  const request = () =>
    fetch(`${baseUrl}/auth/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: 'google-id-token-value' }),
    });
  assert.equal((await request()).status, 200);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.deepEqual(await limited.json(), { code: 'LOGIN_RATE_LIMITED' });
  assert.equal(signInCalls, 1);
});

test('Google login limiter separates Caddy client IPs only when proxy trust is enabled', async (t) => {
  const keys: string[] = [];
  const sessions = authSessionFixture({
    signInWithGoogle: async () => ({
      sessionToken: 'session-proxy', accountId: 'acct_proxy', expiresAt: '2026-10-21T00:00:00.000Z',
    }),
  });
  const limiter = {
    consume: (key: string) => { keys.push(key); return { allowed: true, retryAfterSeconds: 0 }; },
  };
  const start = (trust: boolean) => startFixture(
    t, () => 'unused-account', undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, sessions, limiter, trust,
  );
  const directUrl = await start(false);
  const proxiedUrl = await start(true);
  const signIn = (baseUrl: string, forwardedFor: string) => fetch(`${baseUrl}/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
    body: JSON.stringify({ idToken: 'google-id-token-value' }),
  });

  assert.equal((await signIn(directUrl, '198.51.100.11')).status, 200);
  assert.equal((await signIn(directUrl, '198.51.100.12')).status, 200);
  assert.equal((await signIn(proxiedUrl, '198.51.100.11')).status, 200);
  assert.equal((await signIn(proxiedUrl, '198.51.100.12')).status, 200);
  assert.equal((await signIn(proxiedUrl, '198.51.100.11, 198.51.100.12')).status, 200);
  assert.deepEqual(keys, [
    '127.0.0.1', '127.0.0.1', '198.51.100.11', '198.51.100.12', '127.0.0.1',
  ]);
});

test('fixed-window login limiter tracks independent client keys and resets after the window', () => {
  const Limiter = (serverModule as unknown as {
    FixedWindowAuthLoginLimiter?: new (options: {
      maxAttempts: number;
      windowMs: number;
      now: () => Date;
    }) => AuthLoginLimiterFixture;
  }).FixedWindowAuthLoginLimiter;
  assert.equal(typeof Limiter, 'function');
  let now = new Date('2026-09-21T00:00:00.000Z');
  const limiter = new Limiter!({ maxAttempts: 2, windowMs: 60_000, now: () => now });

  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('127.0.0.1').allowed, false);
  assert.equal(limiter.consume('127.0.0.2').allowed, true);
  now = new Date(now.getTime() + 60_000);
  assert.equal(limiter.consume('127.0.0.1').allowed, true);
});

test('D25 resolves the account from the bearer session and refuses a missing one', async (t) => {
  const sessions = authSessionFixture({
    resolve: async (sessionToken) => {
      if (sessionToken !== 'live-session') throw new AuthSessionError('SESSION_INVALID');
      return 'acct_22222222-2222-4222-8222-222222222222';
    },
  });
  let collectionFor: string | undefined;
  const baseUrl = await startFixture(
    t,
    createBearerAccountResolver(sessions),
    undefined,
    undefined,
    undefined,
    {
      getCollection: async (accountId) => {
        collectionFor = accountId;
        return { visits: [], collectibles: [] };
      },
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sessions,
  );

  const authorized = await fetch(`${baseUrl}/collection`, {
    headers: { authorization: 'Bearer live-session' },
  });
  assert.equal(authorized.status, 200);
  assert.equal(collectionFor, 'acct_22222222-2222-4222-8222-222222222222');

  const anonymous = await fetch(`${baseUrl}/collection`);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { code: 'SESSION_REQUIRED' });

  const stale = await fetch(`${baseUrl}/collection`, {
    headers: { authorization: 'Bearer revoked-session' },
  });
  assert.equal(stale.status, 401);
  assert.deepEqual(await stale.json(), { code: 'SESSION_INVALID' });
});

test('D25 logout revokes the presented session and reauthentication refreshes it', async (t) => {
  const revoked: string[] = [];
  let reauthenticated: readonly [string, string] | undefined;
  const sessions = authSessionFixture({
    logout: async (sessionToken) => {
      revoked.push(sessionToken);
    },
    reauthenticate: async (sessionToken, idToken) => {
      reauthenticated = [sessionToken, idToken];
    },
  });
  const baseUrl = await startFixture(
    t,
    createBearerAccountResolver(sessions),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sessions,
  );

  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { authorization: 'Bearer live-session' },
  });
  assert.equal(logout.status, 200);
  assert.deepEqual(revoked, ['live-session']);

  const refreshed = await fetch(`${baseUrl}/auth/reauthenticate`, {
    method: 'POST',
    headers: { authorization: 'Bearer live-session', 'content-type': 'application/json' },
    body: JSON.stringify({ idToken: 'google-id-token-value' }),
  });
  assert.equal(refreshed.status, 200);
  assert.deepEqual(reauthenticated, ['live-session', 'google-id-token-value']);

  const anonymous = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { code: 'SESSION_REQUIRED' });
});

test('D26 account deletion ignores the DEMO header and requires a recent session authentication', async (t) => {
  let deletionSessionToken: string | undefined;
  const sessions = authSessionFixture({
    resolve: async () => 'acct_33333333-3333-4333-8333-333333333333',
    assertRecentlyAuthenticated: async (sessionToken) => {
      if (sessionToken !== 'recently-authenticated') {
        throw new AuthSessionError('REAUTHENTICATION_REQUIRED');
      }
      return 'acct_33333333-3333-4333-8333-333333333333';
    },
  });
  const result = {
    requestId: '90000000-0000-4000-8000-000000000002',
    status: 'COMPLETED' as const,
    requestedAt: '2026-09-21T00:00:00.000Z',
    completedAt: '2026-09-21T00:00:00.000Z',
    cancelledMintJobs: 0,
    pendingMintJobs: 0,
    retainedFinalizedNfts: 0,
    replayed: false,
  };
  const baseUrl = await startFixture(
    t,
    createBearerAccountResolver(sessions),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { requestDeletion: async (input) => {
      deletionSessionToken = input.sessionToken;
      return result;
    } },
    createSessionReauthenticationGuard(sessions),
    undefined,
    sessions,
  );

  const demoAttempt = await fetch(`${baseUrl}/account-deletion-requests`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer stale-session',
      'content-type': 'application/json',
      'x-demo-reauthenticated': 'true',
    },
    body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
  });
  assert.equal(demoAttempt.status, 401);
  assert.deepEqual(await demoAttempt.json(), { code: 'REAUTHENTICATION_REQUIRED' });

  const authorized = await fetch(`${baseUrl}/account-deletion-requests`, {
    method: 'POST',
    headers: { authorization: 'Bearer recently-authenticated', 'content-type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
  });
  assert.equal(authorized.status, 202);
  assert.deepEqual(await authorized.json(), result);
  assert.equal(deletionSessionToken, 'recently-authenticated');
});

test('D24 refuses to start when the DEMO account header and production login are both configured', () => {
  assert.throws(
    () =>
      resolveAuthMode({
        ALLOW_INSECURE_DEMO_ACCOUNT: 'true',
        GOOGLE_OAUTH_CLIENT_IDS: '1234567890-demo.apps.googleusercontent.com',
        DATABASE_URL: 'postgres://127.0.0.1:5432/masscom',
      }),
    /both/i,
  );
});

test('DEMO header cannot be enabled on a non-loopback API bind', () => {
  assert.throws(
    () => resolveAuthMode({ ALLOW_INSECURE_DEMO_ACCOUNT: 'true', API_BIND_HOST: '0.0.0.0' }),
    /DEMO.*loopback/i,
  );
  assert.deepEqual(
    resolveAuthMode({ ALLOW_INSECURE_DEMO_ACCOUNT: 'true', API_BIND_HOST: '127.0.0.1' }),
    { kind: 'demo' },
  );
});

test('D24 picks production login, the DEMO boundary, or neither from the environment', () => {
  assert.deepEqual(
    resolveAuthMode({
      GOOGLE_OAUTH_CLIENT_IDS:
        '1234567890-demo.apps.googleusercontent.com, 999-other.apps.googleusercontent.com',
      DATABASE_URL: 'postgres://127.0.0.1:5432/masscom',
    }),
    {
      kind: 'production',
      audiences: [
        '1234567890-demo.apps.googleusercontent.com',
        '999-other.apps.googleusercontent.com',
      ],
    },
  );
  assert.deepEqual(resolveAuthMode({ ALLOW_INSECURE_DEMO_ACCOUNT: 'true' }), { kind: 'demo' });
  assert.deepEqual(resolveAuthMode({}), { kind: 'unconfigured' });
  // Client ids without a database are a half-configured production login: refuse, and above all
  // never drop to the DEMO header because it happens to be switched on as well.
  for (const env of [
    { GOOGLE_OAUTH_CLIENT_IDS: '1234567890-demo.apps.googleusercontent.com' },
    {
      GOOGLE_OAUTH_CLIENT_IDS: '1234567890-demo.apps.googleusercontent.com',
      ALLOW_INSECURE_DEMO_ACCOUNT: 'true',
    },
  ]) {
    assert.throws(() => resolveAuthMode(env), /DATABASE_URL is missing/);
  }
});

test('session lifetime from the environment must be a sane whole number of milliseconds', () => {
  assert.equal(sessionTtlMs(undefined), 30 * 24 * 60 * 60 * 1000);
  assert.equal(sessionTtlMs('3600000'), 3_600_000);
  for (const raw of ['30d', '', '0', '-1', '1.5', '1e30', String(366 * 24 * 60 * 60 * 1000)]) {
    assert.throws(() => sessionTtlMs(raw), /AUTH_SESSION_TTL_MS/, raw);
  }
});

test('auth operational limits have bounded defaults and reject unsafe values', () => {
  const config = serverModule as unknown as {
    authLoginLimit(raw: string | undefined): number;
    authLoginWindowMs(raw: string | undefined): number;
    googleJwksMaxStaleMs(raw: string | undefined): number;
    authSessionCleanupBatchSize(raw: string | undefined): number;
  };
  assert.equal(config.authLoginLimit(undefined), 60);
  assert.equal(config.authLoginWindowMs(undefined), 60_000);
  assert.equal(config.googleJwksMaxStaleMs(undefined), 24 * 60 * 60 * 1000);
  assert.equal(config.authSessionCleanupBatchSize(undefined), 100);
  for (const [name, parse, values] of [
    ['AUTH_LOGIN_RATE_LIMIT_MAX', config.authLoginLimit, ['0', '10001']],
    ['AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', config.authLoginWindowMs, ['0', '3600001']],
    ['GOOGLE_JWKS_MAX_STALE_MS', config.googleJwksMaxStaleMs, ['599999', '604800001']],
    ['AUTH_SESSION_CLEANUP_BATCH_SIZE', config.authSessionCleanupBatchSize, ['0', '10001']],
  ] as const) {
    for (const raw of values) assert.throws(() => parse(raw), new RegExp(name), `${name}=${raw}`);
  }
});

test('API bind host stays loopback by default and only permits the container wildcard explicitly', () => {
  assert.equal(resolveApiBindHost(undefined), '127.0.0.1');
  assert.equal(resolveApiBindHost('127.0.0.1'), '127.0.0.1');
  assert.equal(resolveApiBindHost('0.0.0.0'), '0.0.0.0');

  for (const raw of ['', 'localhost', '::', '192.0.2.10', 'api']) {
    assert.throws(() => resolveApiBindHost(raw), /API_BIND_HOST/, raw);
  }
});

const sampleCoupon = {
  couponId: '00000000-0000-4000-8000-000000000001', milestone: 1 as const, merchantId: 'm',
  merchantName: '가상 점포 A', title: '체험 음료 1잔', detail: '시연 혜택', status: 'ISSUED' as const,
  issuedAt: '2026-09-29T00:00:00.000Z', expiresAt: '2026-10-29T00:00:00.000Z', redeemedAt: null,
};
const sampleSnapshot = {
  medals: [
    { kind: 'explorer' as const, value: 2, tier: 2 as const, thresholds: [1, 2, 3] as const },
    { kind: 'regular' as const, value: 1, tier: 0 as const, thresholds: [2, 3, 5] as const },
    { kind: 'steady' as const, value: 1, tier: 0 as const, thresholds: [2, 4, 7] as const },
  ],
  earnedTiers: 2,
  rewards: [1, 2, 3].map((milestone) => ({
    milestone: milestone as 1 | 2 | 3, requiredTiers: milestone * 3, state: 'LOCKED' as const,
    offer: null, coupon: null,
  })),
};

function badgeFixture(overrides: Partial<BadgeRewardService> = {}): BadgeRewardService {
  const unexpected = (name: string) => async () => { throw new Error(`unexpected badge ${name} call`); };
  return {
    getBadges: unexpected('getBadges'), openReward: unexpected('openReward'),
    lookupCoupons: unexpected('lookupCoupons'), redeemCoupon: unexpected('redeemCoupon'),
    ...overrides,
  } as BadgeRewardService;
}

test('GET /me/badges returns the snapshot for the authenticated account only', async (t) => {
  const accounts: string[] = [];
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, undefined, false,
    undefined, undefined, undefined, undefined, badgeFixture({
      getBadges: async (accountId) => { accounts.push(accountId); return sampleSnapshot; },
    }));
  assert.equal((await fetch(`${base}/me/badges`)).status, 401);
  const response = await fetch(`${base}/me/badges`, { headers: { 'x-account-id': 'customer-1' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), sampleSnapshot);
  assert.deepEqual(accounts, ['customer-1']);

  const unconfigured = await startFixture(t);
  const missing = await fetch(`${unconfigured}/me/badges`, { headers: { 'x-account-id': 'customer-1' } });
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { code: 'BADGE_REWARDS_NOT_CONFIGURED' });
});

test('opening a reward box validates the milestone and body and maps reward errors', async (t) => {
  const calls: unknown[] = [];
  let failure: BadgeRewardErrorCode | undefined;
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, undefined, false,
    undefined, undefined, undefined, undefined, badgeFixture({
      openReward: async (input) => {
        calls.push(input);
        if (failure) throw new BadgeRewardError(failure);
        return { coupon: sampleCoupon, replayed: calls.length > 1 };
      },
    }));
  const open = (milestone: string, options: { body?: string; account?: string } = {}) =>
    fetch(`${base}/me/badges/rewards/${milestone}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.account === '' ? {} : { 'x-account-id': options.account ?? 'customer-1' }) },
      ...(options.body === undefined ? {} : { body: options.body }),
    });

  assert.equal((await open('1', { account: '' })).status, 401);
  const first = await open('1');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { coupon: sampleCoupon, replayed: false });
  const replay = await open('1', { body: '{}' });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { coupon: sampleCoupon, replayed: true });
  assert.deepEqual(calls, [
    { accountId: 'customer-1', milestone: 1 },
    { accountId: 'customer-1', milestone: 1 },
  ]);

  for (const milestone of ['0', '4', 'x', '1.5', '%201', '01', '10']) {
    const response = await open(milestone);
    assert.equal(response.status, 400, milestone);
    assert.deepEqual(await response.json(), { code: 'INVALID_REQUEST' });
  }
  for (const body of ['{"milestone":2}', '{"customerAccountId":"forged"}']) {
    const response = await open('2', { body });
    assert.equal(response.status, 400, body);
    assert.deepEqual(await response.json(), { code: 'INVALID_REQUEST' });
  }
  assert.equal((await open('2', { body: '[]' })).status, 400);
  assert.equal((await open('%E0%A4%A')).status, 400);
  assert.equal(calls.length, 2);

  for (const [code, status] of [
    ['REWARD_LOCKED', 409], ['REWARD_OFFER_UNAVAILABLE', 409],
    ['REWARD_CAPACITY_EXHAUSTED', 409], ['ACCOUNT_DELETED', 410],
  ] as const) {
    failure = code;
    const response = await open('3');
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), { code });
  }

  const unconfigured = await startFixture(t);
  assert.equal((await fetch(`${unconfigured}/me/badges/rewards/1/open`, {
    method: 'POST', headers: { 'x-account-id': 'customer-1' },
  })).status, 503);
});

test('staff coupon lookup and redeem check permission, body shape and map coupon errors', async (t) => {
  const calls: unknown[][] = [];
  let allowed = true;
  let failure: BadgeRewardError | CustomerIdentityError | MerchantAccessError | undefined;
  const access: MerchantAccessFixture = { requirePermission: async input => {
    calls.push(['permission', input]);
    if (!allowed) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    return { merchantId: input.merchantId, role: 'STAFF', permissions: ['CONFIRM_VISIT'] };
  } };
  const badges = badgeFixture({
    lookupCoupons: async input => {
      calls.push(['lookup', input]);
      if (failure) throw failure;
      return { identityExpiresAt: '2026-09-29T00:02:00.000Z', coupons: [
        { couponId: sampleCoupon.couponId, title: sampleCoupon.title, detail: sampleCoupon.detail,
          expiresAt: sampleCoupon.expiresAt },
      ] };
    },
    redeemCoupon: async input => {
      calls.push(['redeem', input]);
      if (failure) throw failure;
      return { couponId: input.couponId, status: 'REDEEMED', redeemedAt: '2026-09-29T00:01:00.000Z', replayed: false };
    },
  });
  const base = await startFixture(t, undefined, undefined, access, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, undefined, false,
    undefined, undefined, undefined, undefined, badges);
  const token = 'masscom-customer:v1:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFX';
  const post = (path: string, body: object | string, account = 'staff-1') =>
    fetch(`${base}/merchant/merchants/m/coupons/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(account ? { 'x-account-id': account } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  assert.equal((await post('lookup', { customerIdentityToken: token }, '')).status, 401);
  const lookup = await post('lookup', { customerIdentityToken: token });
  assert.equal(lookup.status, 200);
  const lookupBody = await lookup.json();
  assert.deepEqual(lookupBody, { identityExpiresAt: '2026-09-29T00:02:00.000Z', coupons: [
    { couponId: sampleCoupon.couponId, title: sampleCoupon.title, detail: sampleCoupon.detail,
      expiresAt: sampleCoupon.expiresAt },
  ] });
  assert.equal(JSON.stringify(lookupBody).includes('customer'), false);
  const redeem = await post(`${sampleCoupon.couponId}/redeem`, { customerIdentityToken: token });
  assert.equal(redeem.status, 200);
  assert.deepEqual(await redeem.json(), { couponId: sampleCoupon.couponId, status: 'REDEEMED',
    redeemedAt: '2026-09-29T00:01:00.000Z', replayed: false });
  assert.deepEqual(calls, [
    ['permission', { accountId: 'staff-1', merchantId: 'm', permission: 'CONFIRM_VISIT' }],
    ['lookup', { token, merchantId: 'm', staffAccountId: 'staff-1' }],
    ['permission', { accountId: 'staff-1', merchantId: 'm', permission: 'CONFIRM_VISIT' }],
    ['redeem', { token, merchantId: 'm', staffAccountId: 'staff-1', couponId: sampleCoupon.couponId }],
  ]);

  const before = calls.length;
  for (const suffix of ['lookup', `${sampleCoupon.couponId}/redeem`]) {
    for (const body of [
      {}, { customerIdentityToken: '' }, { customerIdentityToken: 7 },
      { customerIdentityToken: token, customerAccountId: 'forged' },
      { customerIdentityToken: token, useConfirmed: true },
    ]) {
      const response = await post(suffix, body);
      assert.equal(response.status, 400, `${suffix} ${JSON.stringify(body)}`);
      assert.deepEqual(await response.json(), { code: 'INVALID_REQUEST' });
    }
    assert.equal((await post(suffix, '[]')).status, 400);
  }
  assert.equal(calls.filter(call => call[0] !== 'permission').length, 2);
  assert.ok(calls.length > before);

  for (const [error, status] of [
    [new BadgeRewardError('COUPON_NOT_FOUND'), 404],
    [new BadgeRewardError('COUPON_EXPIRED'), 409],
    [new BadgeRewardError('COUPON_SELF_REDEEM'), 403],
    [new BadgeRewardError('ACCOUNT_DELETED'), 410],
    [new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE'), 409],
    [new CustomerIdentityError('CUSTOMER_IDENTITY_EXPIRED'), 410],
    [new MerchantAccessError('MERCHANT_ACCESS_DENIED'), 403],
  ] as const) {
    failure = error;
    for (const suffix of ['lookup', `${sampleCoupon.couponId}/redeem`]) {
      const response = await post(suffix, { customerIdentityToken: token });
      assert.equal(response.status, status, `${error.code} ${suffix}`);
      assert.deepEqual(await response.json(), { code: error.code });
    }
  }
  failure = undefined;

  allowed = false;
  const served = calls.filter(call => call[0] === 'lookup' || call[0] === 'redeem').length;
  for (const suffix of ['lookup', `${sampleCoupon.couponId}/redeem`]) {
    const response = await post(suffix, { customerIdentityToken: token });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: 'MERCHANT_ACCESS_DENIED' });
  }
  assert.equal(calls.filter(call => call[0] === 'lookup' || call[0] === 'redeem').length, served);

  const percent = await fetch(`${base}/merchant/merchants/%E0%A4%A/coupons/lookup`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-account-id': 'staff-1' }, body: '{}',
  });
  assert.equal(percent.status, 400);
  assert.deepEqual(await percent.json(), { code: 'INVALID_PATH_PARAMETER' });

  const unconfigured = await startFixture(t, undefined, undefined, access);
  assert.equal((await fetch(`${unconfigured}/merchant/merchants/m/coupons/lookup`, {
    method: 'POST', headers: { 'x-account-id': 'staff-1' }, body: '{}',
  })).status, 503);
});

test('web badges are read-only, cookie-bound and closed without configuration', async (t) => {
  const accounts: string[] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); }, complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (token !== 'valid-web-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'web-account';
    }, logout: async () => {},
  };
  const base = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth, false,
    undefined, undefined, undefined, undefined, badgeFixture({
      getBadges: async (accountId) => { accounts.push(accountId); return sampleSnapshot; },
    }));
  assert.equal((await webRequest(base, '/api/web/badges')).status, 401);
  assert.equal((await webRequest(base, '/api/web/badges', {
    headers: { cookie: 'web_session=valid-web-cookie' }, host: 'evil.example',
  })).status, 403);
  const response = await webRequest(base, '/api/web/badges', {
    headers: { cookie: 'web_session=valid-web-cookie' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), sampleSnapshot);
  assert.deepEqual(accounts, ['web-account']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  // 웹은 읽기 전용이므로 상자 열기 경로를 열지 않는다.
  assert.equal((await webRequest(base, '/api/web/badges/rewards/1/open', {
    method: 'POST', headers: { cookie: 'web_session=valid-web-cookie', origin: 'https://masscom.kr',
      'content-type': 'application/json' }, body: '{}',
  })).status, 404);

  const unconfigured = await startFixture(t, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false, webAuth);
  const missing = await webRequest(unconfigured, '/api/web/badges', {
    headers: { cookie: 'web_session=valid-web-cookie' },
  });
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { code: 'WEB_BADGES_NOT_CONFIGURED' });
});

test('web merchant coupon routes require origin, JSON, session, permission and membership', async (t) => {
  const calls: unknown[][] = [];
  let allowed = true;
  let member = true;
  let failure: BadgeRewardError | undefined;
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); }, complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (token !== 'staff-cookie') throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return 'staff-account';
    }, logout: async () => {},
  };
  const staff = { mine: async () => member ? [{ id: 'real-merchant', name: '실제 점포', role: 'STAFF' }] : [] } as unknown as
    Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>;
  const access: MerchantAccessFixture = { requirePermission: async input => {
    calls.push(['permission', input]);
    if (!allowed) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    return { merchantId: input.merchantId, role: 'STAFF', permissions: ['CONFIRM_VISIT'] };
  } };
  const badges = badgeFixture({
    lookupCoupons: async input => {
      calls.push(['lookup', input]);
      if (failure) throw failure;
      return { identityExpiresAt: '2026-09-29T00:02:00.000Z', coupons: [] };
    },
    redeemCoupon: async input => {
      calls.push(['redeem', input]);
      if (failure) throw failure;
      return { couponId: input.couponId, status: 'REDEEMED', redeemedAt: '2026-09-29T00:01:00.000Z', replayed: true };
    },
  });
  const base = await startFixture(t, undefined, undefined, access, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, false,
    webAuth, false, undefined, undefined, staff, undefined, badges);
  const headers = { cookie: 'web_session=staff-cookie', origin: 'https://masscom.kr',
    'content-type': 'application/json' };
  const prefix = '/api/web/merchant/merchants/real-merchant/coupons';
  const couponId = sampleCoupon.couponId;
  const post = (suffix: string, body: object | string, customHeaders: Record<string, string> = headers,
    host = 'masscom.kr') => webRequest(base, `${prefix}/${suffix}`, { method: 'POST', headers: customHeaders,
    host, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const token = { customerIdentityToken: 'masscom-customer:v1:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFX' };

  const lookup = await post('lookup', token);
  assert.equal(lookup.status, 200);
  assert.deepEqual(await lookup.json(), { identityExpiresAt: '2026-09-29T00:02:00.000Z', coupons: [] });
  const redeem = await post(`${couponId}/redeem`, token);
  assert.equal(redeem.status, 200);
  assert.deepEqual(await redeem.json(), { couponId, status: 'REDEEMED',
    redeemedAt: '2026-09-29T00:01:00.000Z', replayed: true });
  assert.deepEqual(calls, [
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['lookup', { token: token.customerIdentityToken, merchantId: 'real-merchant', staffAccountId: 'staff-account' }],
    ['permission', { accountId: 'staff-account', merchantId: 'real-merchant', permission: 'CONFIRM_VISIT' }],
    ['redeem', { token: token.customerIdentityToken, merchantId: 'real-merchant',
      staffAccountId: 'staff-account', couponId }],
  ]);
  const served = () => calls.filter(call => call[0] === 'lookup' || call[0] === 'redeem').length;
  const servedBefore = served();

  for (const suffix of ['lookup', `${couponId}/redeem`]) {
    assert.equal((await post(suffix, token, { ...headers, origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(suffix, token, { ...headers, 'content-type': 'text/plain' })).status, 403);
    assert.equal((await post(suffix, token, headers, 'api.masscom.kr')).status, 403);
    assert.equal((await post(suffix, token, { ...headers, cookie: '' })).status, 401);
    assert.equal((await post(suffix, { ...token, customerAccountId: 'forged' })).status, 400);
    assert.equal((await post(suffix, {})).status, 400);
  }
  allowed = false;
  for (const suffix of ['lookup', `${couponId}/redeem`]) assert.equal((await post(suffix, token)).status, 403);
  allowed = true;
  member = false;
  for (const suffix of ['lookup', `${couponId}/redeem`]) assert.equal((await post(suffix, token)).status, 403);
  member = true;
  assert.equal(served(), servedBefore);

  failure = new BadgeRewardError('COUPON_NOT_FOUND');
  assert.equal((await post(`${couponId}/redeem`, token)).status, 404);
  failure = new BadgeRewardError('COUPON_EXPIRED');
  const expired = await post(`${couponId}/redeem`, token);
  assert.equal(expired.status, 409);
  assert.deepEqual(await expired.json(), { code: 'COUPON_EXPIRED' });
  failure = new BadgeRewardError('COUPON_SELF_REDEEM');
  const own = await post(`${couponId}/redeem`, token);
  assert.equal(own.status, 403);
  assert.deepEqual(await own.json(), { code: 'COUPON_SELF_REDEEM' });
});
