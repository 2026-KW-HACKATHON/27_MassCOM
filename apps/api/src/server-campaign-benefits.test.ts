import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ApiDeps } from './api-deps.js';
import { BadgeRewardError } from './badge-rewards.js';
import { CampaignBenefitError, type CampaignBenefitErrorCode, type CampaignBenefitService, type CampaignBenefitStatus } from './campaign-benefits.js';
import { listen, send, walletService, webHeaders } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import type { WebAuthHandler } from './web-auth.js';

const status: CampaignBenefitStatus = {
  id: 'benefit-1', campaignId: 'campaign-1', merchantId: 'merchant-1', title: '작은 구성', detail: '',
  status: 'ACTIVE', validDays: 30, maxUses: 2, issuedCount: 1, unitExtraCostWon: 500,
  issued: 1, redeemed: 0, usable: 1, expiredUnused: 0, additionalIssuable: 1,
  costBorne: '0', maxExposure: '1000', promisedMaxCost: '500',
};
const coupon = {
  couponId: 'coupon-1', milestone: 3 as const, merchantId: 'merchant-1', merchantName: '가게',
  title: '작은 구성', detail: '', status: 'ISSUED' as const, issuedAt: '2026-10-08T00:00:00.000Z',
  expiresAt: '2026-11-07T00:00:00.000Z', redeemedAt: null,
};
const input = { title: '작은 구성', detail: '', validDays: 30, unitExtraCostWon: 500, maxUses: 2,
  consentDocumentRef: 'BEN-T3B', consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true } };

function fixture(overrides: Partial<CampaignBenefitService> = {}, deps: Partial<ApiDeps> = {}) {
  const calls: unknown[] = [];
  const campaignBenefits: CampaignBenefitService = {
    createBenefit: async value => { calls.push(value); return status; },
    pauseBenefit: async value => { calls.push(value); return { ...status, status: 'PAUSED' }; },
    getBenefitStatus: async value => { calls.push(value); return { benefit: status, benefits: [status] }; },
    listBenefits: async accountId => { calls.push(accountId); return { benefits: [] }; },
    claimBenefit: async value => { calls.push(value); return { coupon, replayed: false }; },
    ...overrides,
  };
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('unused'); }, complete: async () => { throw new Error('unused'); },
    resolveSession: async () => 'session-account', resolveSessionWithAge: async () => ({ accountId: 'session-account', ageMs: 0 }),
    logout: async () => {},
  };
  const server = createApiServer({ service: walletService(), baseAccountResolver: developmentHeaderAccountResolver,
    campaignBenefits, webAuth,
    admin: { isAdmin: async () => true } as unknown as ApiDeps['admin'],
    staffRegistration: {} as ApiDeps['staffRegistration'], ...deps });
  return { server, calls };
}

test('고객 혜택 목록과 수령은 인증 계정만 쓰고 최초 수령은 201, 재생은 200이다', async t => {
  let replayed = false;
  const { server, calls } = fixture({ claimBenefit: async value => { calls.push(value); return { coupon, replayed }; } });
  const port = await listen(t, server);
  const headers = { 'x-account-id': 'customer', 'content-type': 'application/json' };
  assert.equal((await send(port, 'GET', '/me/campaign-benefits', { headers })).status, 200);
  const first = await send(port, 'POST', '/me/campaign-benefits/benefit-1/claim', { headers, body: '{}' });
  assert.equal(first.status, 201);
  assert.deepEqual(first.json, { coupon, replayed: false });
  replayed = true;
  assert.equal((await send(port, 'POST', '/me/campaign-benefits/benefit-1/claim', { headers })).status, 200);
  assert.deepEqual(calls, ['customer', { accountId: 'customer', benefitId: 'benefit-1' }, { accountId: 'customer', benefitId: 'benefit-1' }]);
  const unauthenticated = await send(port, 'GET', '/me/campaign-benefits');
  assert.equal(unauthenticated.status, 401);
});

test('수령 본문에 계정·비용 등 추가 값을 넣으면 서비스 호출 전 거절한다', async t => {
  const { server, calls } = fixture();
  const port = await listen(t, server);
  const response = await send(port, 'POST', '/me/campaign-benefits/benefit-1/claim', {
    headers: { 'x-account-id': 'customer', 'content-type': 'application/json' }, body: '{"accountId":"other"}',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test('혜택 상한·중지·권한·입력 오류는 정해진 HTTP 상태와 코드를 낸다', async t => {
  let code: CampaignBenefitErrorCode = 'CAP_REACHED';
  const { server } = fixture({ claimBenefit: async () => { throw new CampaignBenefitError(code); } });
  const port = await listen(t, server);
  for (const [errorCode, expected] of [
    ['CAP_REACHED', 409], ['BENEFIT_PAUSED', 409], ['BENEFIT_NOT_ELIGIBLE', 403], ['BENEFIT_NOT_FOUND', 404],
    ['ACCOUNT_DELETED', 410], ['OWNER_FORBIDDEN', 403], ['ADMIN_INVALID_INPUT', 400], ['ADMIN_DOCUMENT_REF_INVALID', 400],
  ] as const) {
    code = errorCode;
    const response = await send(port, 'POST', '/me/campaign-benefits/benefit-1/claim', { headers: { 'x-account-id': 'customer' } });
    assert.equal(response.status, expected, code);
    assert.deepEqual(response.json, { code });
  }
});

test('관리자 생성은 비용·상한·동의 다섯 항목을 전달하고 조회·중지는 웹 세션 계정으로 처리한다', async t => {
  const { server, calls } = fixture();
  const port = await listen(t, server);
  const created = await send(port, 'POST', '/api/web/admin/campaigns/campaign-1/benefit', { headers: webHeaders, body: JSON.stringify(input) });
  assert.equal(created.status, 201);
  assert.deepEqual(calls[0], { ...input, adminAccountId: 'session-account', campaignId: 'campaign-1' });
  const fetched = await send(port, 'GET', '/api/web/admin/campaigns/campaign-1/benefit-status', { headers: webHeaders });
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.json, { benefit: status, benefits: [status] });
  assert.equal((await send(port, 'POST', '/api/web/admin/campaigns/campaign-1/benefit/pause', { headers: webHeaders, body: '{}' })).status, 200);
  assert.deepEqual(calls.slice(1), [{ accountId: 'session-account', campaignId: 'campaign-1' },
    { adminAccountId: 'session-account', campaignId: 'campaign-1' }]);
});

test('관리자 권한·동일 Origin·허용 입력을 확인한 뒤에만 혜택 서비스로 들어간다', async t => {
  const { server, calls } = fixture();
  const port = await listen(t, server);
  assert.equal((await send(port, 'POST', '/api/web/admin/campaigns/campaign-1/benefit', {
    headers: { ...webHeaders, origin: 'https://other.invalid' }, body: JSON.stringify(input),
  })).status, 403);
  assert.equal((await send(port, 'POST', '/api/web/admin/campaigns/campaign-1/benefit', {
    headers: webHeaders, body: JSON.stringify({ ...input, issuedCount: 0 }),
  })).status, 400);
  assert.deepEqual(calls, []);
  const denied = fixture({}, { admin: { isAdmin: async () => false } as unknown as ApiDeps['admin'] });
  const deniedPort = await listen(t, denied.server);
  assert.equal((await send(deniedPort, 'GET', '/api/web/admin/campaigns/campaign-1/benefit-status', { headers: webHeaders })).status, 403);
  assert.deepEqual(denied.calls, []);
});

test('점주 혜택 상태는 점포·캠페인·웹 세션 계정을 서비스에 전달하고 읽기만 허용한다', async t => {
  const { server, calls } = fixture();
  const port = await listen(t, server);
  const path = '/api/web/merchant/merchants/merchant-1/campaigns/campaign-1/benefit-status';
  assert.equal((await send(port, 'GET', path, { headers: webHeaders })).status, 200);
  assert.deepEqual(calls, [{ accountId: 'session-account', merchantId: 'merchant-1', campaignId: 'campaign-1' }]);
  assert.equal((await send(port, 'POST', path, { headers: webHeaders, body: '{}' })).status, 404);
  assert.equal(calls.length, 1);
});

test('혜택 서비스가 없는 옛 배치는 새 경로만 503으로 끝낸다', async t => {
  const { server } = fixture({}, { campaignBenefits: undefined });
  const port = await listen(t, server);
  assert.equal((await send(port, 'GET', '/me/campaign-benefits', { headers: { 'x-account-id': 'customer' } })).status, 503);
});

test('쿠폰의 다음 방문 사용 시각 오류는 409이며 기존 직원 조회 경로를 유지한다', async t => {
  const { server } = fixture({ claimBenefit: async () => { throw new BadgeRewardError('COUPON_NOT_YET_USABLE'); } });
  const port = await listen(t, server);
  const response = await send(port, 'POST', '/me/campaign-benefits/benefit-1/claim', { headers: { 'x-account-id': 'customer' } });
  assert.equal(response.status, 409);
  assert.deepEqual(response.json, { code: 'COUPON_NOT_YET_USABLE' });
});
