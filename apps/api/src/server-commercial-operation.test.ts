import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { MerchantAccessError } from './merchant-access.js';
import { MerchantProfileError, type MerchantProfile } from './merchant-profile.js';
import { AdminError } from './postgres/admin.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';
import { WebAuthError } from './web-auth.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const campaignPath = '/api/web/admin/campaigns/campaign-1/extend';
const profilePath = '/api/web/merchant/merchants/store-1/profile';
const campaign = { id: 'campaign-1', merchantId: 'store-1', merchantName: '가게', title: '캠페인',
  startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z',
  enrollmentCapacity: 20, enrolledCount: 1, rewardGoals: [], status: 'ACTIVE', public: true };
const extension = { days: 30, expectedEndsAt: campaign.endsAt };
const profile = { merchantId: 'store-1', name: '가게', roadAddress: '서울', story: '소개',
  businessHours: '매일 10:00', menuItems: [{ name: '커피', priceWon: 4000 }], version: 3,
  canEdit: true, readOnlyReason: null };
const profileUpdate = { story: '새 소개', businessHours: '매일 11:00',
  menuItems: [{ name: '차', priceWon: 5000 }], expectedVersion: 3 };

type Response = { status: number; headers: Record<string, unknown>; body: unknown };
async function request(server: Server, method: string, url: string, options: {
  cookie?: string | undefined; origin?: string; contentType?: string; body?: unknown; rawBody?: string;
} = {}): Promise<Response> {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method;
  incoming.url = url;
  incoming.httpVersion = '1.0';
  incoming.headers = { host: 'masscom.kr',
    ...(options.cookie === undefined ? {} : { cookie: `web_session=${options.cookie}` }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.contentType === undefined ? {} : { 'content-type': options.contentType }) };
  if (options.rawBody !== undefined) incoming.push(options.rawBody);
  else if (options.body !== undefined) incoming.push(JSON.stringify(options.body));
  incoming.push(null);
  const response = new ServerResponse(incoming);
  const transport = new PassThrough();
  const chunks: Buffer[] = [];
  transport.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.assignSocket(transport as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
    server.emit('request', incoming, response);
  });
  const payload = Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]!;
  return { status: response.statusCode, headers: response.getHeaders(), body: payload ? JSON.parse(payload) as unknown : undefined };
}

const authenticated = { cookie: 'admin', origin: 'https://masscom.kr', contentType: 'application/json' };
const merchantAuthenticated = { cookie: 'owner', origin: 'https://masscom.kr', contentType: 'application/json' };

function fixture(options: { adminAccount?: boolean; member?: boolean; adminError?: AdminError;
  profileError?: MerchantProfileError; profile?: MerchantProfile } = {}) {
  const calls: unknown[][] = [];
  const challenge = new WalletChallengeService({ store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify', chainId: 84532,
    ttlMs: 300000, nonce: () => 'abc12345def67890', challengeId: () => 'operation-http' });
  const args: Parameters<typeof createApiServer> = [challenge, developmentHeaderAccountResolver];
  args[3] = { requirePermission: async input => {
    calls.push(['permission', input]);
    if (options.member === false) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    return { merchantId: input.merchantId, role: 'OWNER', permissions: ['VIEW_MERCHANT'] };
  } };
  args[14] = { start: async () => { throw new Error('not used'); },
    complete: async () => { throw new Error('not used'); },
    resolveSession: async token => {
      if (!['admin', 'owner', 'other'].includes(token)) throw new WebAuthError('WEB_AUTH_STATE_INVALID');
      return `${token}-account`;
    }, resolveSessionWithAge: async () => ({ accountId: 'owner-account', ageMs: 0 }),
    logout: async () => {},
  } as NonNullable<typeof args[14]>;
  args[17] = {
    isAdmin: async () => options.adminAccount !== false,
    listCampaigns: async (accountId: string) => { calls.push(['list', accountId]); return [campaign]; },
    extendCampaign: async (accountId: string, campaignId: string, days: number, expectedEndsAt: string) => {
      calls.push(['extend', accountId, campaignId, days, expectedEndsAt]);
      if (options.adminError) throw options.adminError;
      return campaign;
    },
  } as unknown as NonNullable<typeof args[17]>;
  args[38] = {
    getProfile: async (input: { accountId: string; merchantId: string }) => {
      calls.push(['get', input]);
      if (options.profileError) throw options.profileError;
      return options.profile ?? profile;
    },
    updateProfile: async (input: { accountId: string; merchantId: string; body: unknown }) => {
      calls.push(['update', input]);
      if (options.profileError) throw options.profileError;
      return options.profile ?? profile;
    },
  } as unknown as NonNullable<typeof args[38]>;
  return { server: createApiServer(...args), calls };
}

test('campaign list includes an ISO server generatedAt alongside campaigns', async () => {
  const { server } = fixture();
  const response = await request(server, 'GET', '/api/web/admin/campaigns', { cookie: 'admin' });
  assert.equal(response.status, 200);
  const body = response.body as { campaigns: unknown; generatedAt: string };
  assert.deepEqual(body.campaigns, [campaign]);
  assert.equal(new Date(body.generatedAt).toISOString(), body.generatedAt);
});

test('campaign extension requires a valid administrator web session', async () => {
  const { server, calls } = fixture();
  assert.equal((await request(server, 'POST', campaignPath, { ...authenticated, cookie: undefined, body: extension })).status, 401);
  assert.equal((await request(server, 'POST', campaignPath, { ...authenticated, cookie: 'bad', body: extension })).status, 401);
  assert.deepEqual(calls, []);
});

test('campaign extension rejects a web session without administrator role', async () => {
  const { server, calls } = fixture({ adminAccount: false });
  const response = await request(server, 'POST', campaignPath, { ...authenticated, body: extension });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { code: 'ADMIN_FORBIDDEN' });
  assert.deepEqual(calls, []);
});

test('campaign extension requires same-origin JSON', async () => {
  const { server, calls } = fixture();
  for (const options of [
    { ...authenticated, origin: 'https://evil.example', body: extension },
    { ...authenticated, contentType: 'text/plain', body: extension },
  ]) {
    const response = await request(server, 'POST', campaignPath, options);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { code: 'ADMIN_CSRF_FORBIDDEN' });
  }
  assert.deepEqual(calls, []);
});

test('campaign extension forwards only 30 or 90 days and the expected end', async () => {
  const { server, calls } = fixture();
  for (const days of [30, 90]) {
    const response = await request(server, 'POST', campaignPath, { ...authenticated, body: { ...extension, days } });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, campaign);
  }
  assert.deepEqual(calls, [
    ['extend', 'admin-account', 'campaign-1', 30, campaign.endsAt],
    ['extend', 'admin-account', 'campaign-1', 90, campaign.endsAt],
  ]);
});

test('campaign extension rejects unknown keys, invalid days and malformed expected end before service call', async () => {
  const { server, calls } = fixture();
  for (const body of [{ ...extension, extra: true }, { ...extension, days: 31 },
    { ...extension, days: '30' }, { days: 30 }, { ...extension, expectedEndsAt: 'yesterday' }]) {
    const response = await request(server, 'POST', campaignPath, { ...authenticated, body });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(calls, []);
});

test('campaign extension maps CAS, invalid state, active conflict and horizon errors', async () => {
  for (const [code, status] of [
    ['ADMIN_VERSION_CONFLICT', 409], ['ADMIN_CAMPAIGN_NOT_EXTENDABLE', 409], ['ADMIN_CAMPAIGN_EXTENSION_LIMIT', 409],
    ['ADMIN_CAMPAIGN_ACTIVE_EXISTS', 409], ['ADMIN_CAMPAIGN_NOT_FOUND', 404], ['ADMIN_INVALID_INPUT', 400],
  ] as const) {
    const { server } = fixture({ adminError: new AdminError(code) });
    const response = await request(server, 'POST', campaignPath, { ...authenticated, body: extension });
    assert.equal(response.status, status, code);
    assert.deepEqual(response.body, { code });
  }
});

test('merchant profile GET requires a merchant web session and active VIEW_MERCHANT membership', async () => {
  const { server, calls } = fixture();
  assert.equal((await request(server, 'GET', profilePath)).status, 401);
  assert.deepEqual(calls, []);
  const denied = fixture({ member: false });
  const response = await request(denied.server, 'GET', profilePath, { cookie: 'owner' });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { code: 'MERCHANT_ACCESS_DENIED' });
  assert.deepEqual(denied.calls, [['permission', { accountId: 'owner-account', merchantId: 'store-1', permission: 'VIEW_MERCHANT' }]]);
});

test('merchant profile GET returns edit capability and the public store fields', async () => {
  const { server, calls } = fixture();
  const response = await request(server, 'GET', profilePath, { cookie: 'owner' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, profile);
  assert.deepEqual(calls, [
    ['permission', { accountId: 'owner-account', merchantId: 'store-1', permission: 'VIEW_MERCHANT' }],
    ['get', { accountId: 'owner-account', merchantId: 'store-1' }],
  ]);
});

test('merchant profile GET returns a read-only reason for a shared demo store', async () => {
  const readOnly = { ...profile, canEdit: false, readOnlyReason: 'SHARED_DEMO_STORE' as const };
  const { server } = fixture({ profile: readOnly });
  const response = await request(server, 'GET', profilePath, { cookie: 'owner' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, readOnly);
});

test('merchant profile PUT requires same-origin JSON and a session', async () => {
  const { server, calls } = fixture();
  assert.equal((await request(server, 'PUT', profilePath, { ...merchantAuthenticated, cookie: undefined,
    body: profileUpdate })).status, 401);
  for (const options of [
    { ...merchantAuthenticated, origin: 'https://evil.example', body: profileUpdate },
    { ...merchantAuthenticated, contentType: 'text/plain', body: profileUpdate },
  ]) {
    const response = await request(server, 'PUT', profilePath, options);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { code: 'MERCHANT_CSRF_FORBIDDEN' });
  }
  assert.deepEqual(calls, []);
});

test('merchant profile PUT checks membership before invoking the edit service', async () => {
  const { server, calls } = fixture({ member: false });
  const response = await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body: profileUpdate });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { code: 'MERCHANT_ACCESS_DENIED' });
  assert.deepEqual(calls, [['permission', { accountId: 'owner-account', merchantId: 'store-1', permission: 'VIEW_MERCHANT' }]]);
});

test('merchant profile PUT forwards a valid owner edit and returns the profile shape', async () => {
  const { server, calls } = fixture();
  const response = await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body: profileUpdate });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, profile);
  assert.deepEqual(calls, [
    ['permission', { accountId: 'owner-account', merchantId: 'store-1', permission: 'VIEW_MERCHANT' }],
    ['update', { accountId: 'owner-account', merchantId: 'store-1', body: profileUpdate }],
  ]);
});

test('merchant profile PUT rejects unknown or missing keys before update', async () => {
  const { server, calls } = fixture();
  for (const body of [{ ...profileUpdate, name: 'changed' }, { ...profileUpdate, roadAddress: 'changed' },
    { story: 'x', businessHours: '', menuItems: [] }, { ...profileUpdate, expectedVersion: '3' }]) {
    const response = await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { code: 'MERCHANT_PROFILE_INVALID' });
  }
  assert.equal(calls.some(call => call[0] === 'update'), false);
});

test('merchant profile PUT maps role, shared demo, validation and CAS refusals', async () => {
  for (const [code, status] of [
    ['MERCHANT_PROFILE_FORBIDDEN', 403], ['MERCHANT_PROFILE_READ_ONLY', 403],
    ['MERCHANT_PROFILE_INVALID', 400], ['MERCHANT_PROFILE_VERSION_CONFLICT', 409],
  ] as const) {
    const error = new MerchantProfileError(code);
    const { server } = fixture({ profileError: error });
    const response = await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body: profileUpdate });
    assert.equal(response.status, status, code);
    assert.deepEqual(response.body, { code });
  }
});

test('merchant profile PUT is limited per account with Retry-After', async () => {
  const { server, calls } = fixture();
  for (let attempt = 0; attempt < 30; attempt++) {
    assert.equal((await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body: profileUpdate })).status, 200);
  }
  const limited = await request(server, 'PUT', profilePath, { ...merchantAuthenticated, body: profileUpdate });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { code: 'MERCHANT_PROFILE_RATE_LIMITED' });
  assert.ok(Number(limited.headers['retry-after']) > 0);
  assert.equal(calls.filter(call => call[0] === 'update').length, 30);
  // 제한된 요청은 멤버십 조회에도 닿지 않는다.
  assert.equal(calls.filter(call => call[0] === 'permission').length, 30);
  assert.equal((await request(server, 'PUT', profilePath, { ...merchantAuthenticated, cookie: 'other', body: profileUpdate })).status, 200);
});
