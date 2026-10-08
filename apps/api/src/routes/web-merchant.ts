import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { collectibleBodyLimit, type CollectibleProjectService } from '../collectible-project.js';
import { renderClaimQr } from '../http/claim-qr.js';
import { authLoginClientKey, requireWebCookie } from '../http/request-auth.js';
import {
  MAX_BODY_BYTES, decodePathParameter, readJson, requireIdentityTokenBody, requirePositiveInteger, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { matchReversalRoute, runReversalRoute } from '../http/reversal-route.js';
import { sendJson } from '../http/response.js';
import { MerchantAccessError } from '../merchant-access.js';
import { MerchantProfileError } from '../merchant-profile.js';
import { resolveWebOrigin } from '../web-origin.js';
import type { RouteContext } from './context.js';

export async function handleWebMerchant(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const {
    merchantAccess, claimSlots, customerIdentities, badges, reversals, merchantOverview, visitorFeedback,
    webAuth, staffRegistration, authLoginLimiter, collectibleProjects, merchantProfile,
  } = deps;
  const { trustProxyClientIp } = deps;
  const { webWwwEnabled } = deps;
  const { merchantOperations } = deps.experienceServices;
  const { requireCustomerScan, merchantProfileWriteLimiter, merchantOperationLimiter, collectibleWriteLimiter } = runtime;
  if (path.startsWith('/api/web/merchant/')) {
    const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    const profileMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/profile$/);
    if (!webAuth || (!staffRegistration && !profileMatch)) throw new RequestError(503, 'WEB_MERCHANT_NOT_CONFIGURED');
    if (path === '/api/web/merchant/auth/start' && request.method === 'GET') {
      if (authLoginLimiter) {
        const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
          return true;
        }
      }
      const started = await webAuth.start(origin, '/merchant/');
      response.setHeader('set-cookie', `web_auth_state=${started.state}; Path=/api/web/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
      response.setHeader('location', started.location);
      response.writeHead(302).end();
      return true;
    }
    if (request.method !== 'GET' && (request.headers.origin !== origin ||
        !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))) {
      throw new RequestError(403, 'MERCHANT_CSRF_FORBIDDEN');
    }
    const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
    const operationMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/(campaigns|staff|visits\.csv)(?:\/([^/]+)(?:\/(extend))?)?$/);
    if (operationMatch) {
      if (!merchantOperations) throw new RequestError(503, 'MERCHANT_OPERATIONS_NOT_CONFIGURED');
      if (request.method !== 'GET' || operationMatch[2] === 'visits.csv') {
        const decision = merchantOperationLimiter.consume(accountId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          throw new RequestError(429, 'MERCHANT_OPERATIONS_RATE_LIMITED');
        }
      }
      const merchantId = decodePathParameter(operationMatch[1]!);
      const kind = operationMatch[2];
      const target = operationMatch[3] && decodePathParameter(operationMatch[3]);
      if (kind === 'campaigns' && !target && request.method === 'GET') {
        sendJson(response, 200, { campaigns: await merchantOperations.listCampaigns(accountId, merchantId) });
      } else if (kind === 'campaigns' && target && operationMatch[4] === 'extend' && request.method === 'POST') {
        const body = await readJson(request);
        if (Object.keys(body).some(key => !['days','expectedEndsAt','consentAccepted','requestId'].includes(key)) ||
            (body.days !== 30 && body.days !== 90) || body.consentAccepted !== true) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        sendJson(response, 200, await merchantOperations.extendCampaign({ accountId, merchantId, campaignId: target,
          days: body.days, expectedEndsAt: requireString(body, 'expectedEndsAt'), consentAccepted: true,
          requestId: requireString(body, 'requestId') }));
      } else if (kind === 'staff' && !target && request.method === 'GET') {
        sendJson(response, 200, { staff: await merchantOperations.listStaff(accountId, merchantId) });
      } else if (kind === 'staff' && target === 'approve' && request.method === 'POST') {
        const body = await readJson(request);
        if (Object.keys(body).some(key => key !== 'code')) throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 200, await merchantOperations.approveStaff({ accountId, merchantId, code: requireString(body, 'code') }));
      } else if (kind === 'staff' && target && request.method === 'PATCH') {
        const body = await readJson(request);
        if (Object.keys(body).some(key => !['confirmVisit','redeemCoupon'].includes(key)) ||
            typeof body.confirmVisit !== 'boolean' || typeof body.redeemCoupon !== 'boolean') {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        sendJson(response, 200, await merchantOperations.updateStaffPermissions({ accountId, merchantId, targetAccountId: target,
          confirmVisit: body.confirmVisit, redeemCoupon: body.redeemCoupon }));
      } else if (kind === 'staff' && target && request.method === 'DELETE') {
        await merchantOperations.revokeStaff({ accountId, merchantId, targetAccountId: target });
        response.writeHead(204).end();
      } else if (kind === 'visits.csv' && !target && request.method === 'GET') {
        const query = new URL(request.url!, 'http://localhost').searchParams;
        if ([...query.keys()].some(key => key !== 'from' && key !== 'to') ||
            query.getAll('from').length !== 1 || query.getAll('to').length !== 1) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        const result = await merchantOperations.exportVisits({ accountId, merchantId,
          fromDate: query.get('from')!, toDate: query.get('to')! });
        response.setHeader('content-type', 'text/csv; charset=utf-8');
        response.setHeader('content-disposition', `attachment; filename="${result.filename}"`);
        response.setHeader('x-visit-count', String(result.count));
        response.writeHead(200).end(result.csv);
      } else throw new RequestError(404, 'NOT_FOUND');
      return true;
    }
    if (profileMatch && (request.method === 'GET' || request.method === 'PUT')) {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      // 저장 제한은 멤버십 조회보다 먼저 센다: 멤버가 아닌 계정의 반복 요청도 DB에 닿기 전에 막는다.
      if (request.method === 'PUT') {
        const decision = merchantProfileWriteLimiter.consume(accountId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'MERCHANT_PROFILE_RATE_LIMITED' });
          return true;
        }
      }
      const merchantId = decodePathParameter(profileMatch[1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'VIEW_MERCHANT' });
      if (!merchantProfile) throw new RequestError(503, 'MERCHANT_PROFILE_NOT_CONFIGURED');
      if (request.method === 'GET') {
        sendJson(response, 200, await merchantProfile.getProfile({ accountId, merchantId }));
      } else {
        const body = await readJson(request);
        const keys = ['story', 'businessHours', 'menuItems', 'expectedVersion'];
        if (Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !(key in body)) ||
            !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) {
          throw new MerchantProfileError('MERCHANT_PROFILE_INVALID');
        }
        sendJson(response, 200, await merchantProfile.updateProfile({ accountId, merchantId, body }));
      }
      return true;
    }
    if (!staffRegistration) throw new RequestError(503, 'WEB_MERCHANT_NOT_CONFIGURED');
    if (path === '/api/web/merchant/me' && request.method === 'GET') {
      sendJson(response, 200, { merchants: await staffRegistration.mine(accountId),
        accountScope: createHash('sha256').update(`collectible-editor:${accountId}`).digest('hex') });
      return true;
    }
    const collectibleCampaigns = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/collectible-campaigns$/);
    if (collectibleCampaigns && request.method === 'GET') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      const merchantId = decodePathParameter(collectibleCampaigns[1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      if (!collectibleProjects) throw new RequestError(503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED');
      sendJson(response, 200, { campaigns: await collectibleProjects.listCampaigns({ merchantId, accountId }) });
      return true;
    }
    const webCollectibleRoute = matchCollectibleProjectRoute(request.method, path, '/api/web/merchant/merchants/');
    if (webCollectibleRoute) {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      const merchantId = decodePathParameter(webCollectibleRoute.merchantId);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      if (!collectibleProjects) throw new RequestError(503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED');
      if (['create', 'save', 'copy', 'publish'].includes(webCollectibleRoute.kind)) {
        const decision = collectibleWriteLimiter.consume(merchantId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'COLLECTIBLE_RATE_LIMITED' });
          return true;
        }
      }
      await runCollectibleProjectRoute(collectibleProjects, webCollectibleRoute, merchantId, accountId, request, response);
      return true;
    }
    if (path === '/api/web/merchant/registration-merchants' && request.method === 'GET') {
      sendJson(response, 200, { merchants: await staffRegistration.eligible(accountId) });
      return true;
    }
    if (path === '/api/web/merchant/registration-requests' && request.method === 'POST') {
      const body = await readJson(request);
      sendJson(response, 201, await staffRegistration.request(accountId, requireString(body, 'merchantId')));
      return true;
    }
    const webReversal = matchReversalRoute(request.method, path, '/api/web/merchant/merchants/');
    if (webReversal) {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      if (!reversals) throw new RequestError(503, 'REVERSALS_NOT_CONFIGURED');
      const merchantId = decodePathParameter(webReversal.merchantId);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: webReversal.kind === 'recent-coupons' || webReversal.kind === 'undo-coupon' ? 'REDEEM_COUPON' : 'CONFIRM_VISIT' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      sendJson(response, 200, await runReversalRoute(reversals, webReversal, merchantId, accountId, request));
      return true;
    }
    // 가게 현황(#330): 읽기 전용. 최근 방문 목록과 같은 권한(CONFIRM_VISIT)과 점포 소속 확인이라 활성 점주·직원 모두 볼 수 있다.
    const overviewMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/overview$/);
    if (overviewMatch && request.method === 'GET') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      if (!merchantOverview) throw new RequestError(503, 'MERCHANT_OVERVIEW_NOT_CONFIGURED');
      const merchantId = decodePathParameter(overviewMatch[1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      sendJson(response, 200, await merchantOverview.overview({ merchantId }));
      return true;
    }
    // 그 가게 점주·직원만 보는 손님 의견 요약(#334): 태그·바라는 점 개수와 최근 의견 50건(가린 손님 표시와 날짜만).
    const webVisitorFeedback = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/visitor-feedback$/);
    if (webVisitorFeedback && request.method === 'GET') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      if (!visitorFeedback) throw new RequestError(503, 'VISITOR_FEEDBACK_NOT_CONFIGURED');
      const merchantId = decodePathParameter(webVisitorFeedback[1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      sendJson(response, 200, await visitorFeedback.merchantSummary(merchantId));
      return true;
    }
    const claimMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/(customer-identities\/resolve|claim-slots)$/);
    const reissueMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/claim-slots\/([^/]+)\/reissue$/);
    if (reissueMatch && request.method === 'POST') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
      const merchantId = decodePathParameter(reissueMatch[1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'expectedTokenVersion')) {
        throw new RequestError(400, 'INVALID_REQUEST');
      }
      const issued = await claimSlots.reissue({
        merchantId, claimSlotId: decodePathParameter(reissueMatch[2]!),
        expectedTokenVersion: requirePositiveInteger(body, 'expectedTokenVersion'),
        requestedByAccountId: accountId,
      });
      sendJson(response, 200, { ...issued, ...await renderClaimQr(issued.token) });
      return true;
    }
    const couponLookupMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/coupons\/lookup$/);
    const couponRedeemMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/coupons\/([^/]+)\/redeem$/);
    if ((couponLookupMatch || couponRedeemMatch) && request.method === 'POST') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
      const merchantId = decodePathParameter((couponLookupMatch ?? couponRedeemMatch)![1]!);
      await merchantAccess.requirePermission({ accountId, merchantId, permission: 'REDEEM_COUPON' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      const customerIdentityToken = requireIdentityTokenBody(await readJson(request));
      if (couponLookupMatch) {
        sendJson(response, 200, await badges.lookupCoupons({
          token: customerIdentityToken, merchantId, staffAccountId: accountId,
        }));
      } else {
        sendJson(response, 200, await badges.redeemCoupon({
          token: customerIdentityToken, merchantId, staffAccountId: accountId,
          couponId: decodePathParameter(couponRedeemMatch![2]!),
        }));
      }
      return true;
    }
    if (claimMatch && request.method === 'POST') {
      if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
      const merchantId = decodePathParameter(claimMatch[1]!);
      if (claimMatch[2] === 'customer-identities/resolve') await requireCustomerScan(accountId, merchantId);
      else await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
      if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      const body = await readJson(request);
      if ('customerAccountId' in body) throw new RequestError(400, 'INVALID_REQUEST');
      const customerIdentityToken = requireString(body, 'customerIdentityToken');
      if (claimMatch[2] === 'customer-identities/resolve') {
        if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
        sendJson(response, 200, await customerIdentities.resolve({
          token: customerIdentityToken, merchantId, staffAccountId: accountId,
        }));
      } else {
        if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        if (body.useConfirmed !== true) throw new RequestError(400, 'INVALID_REQUEST');
        const issued = await claimSlots.issue({
          merchantId, customerIdentityToken, merchantReference: requireString(body, 'merchantReference'),
          createdByAccountId: accountId,
        });
        if ('replayed' in issued) {
          sendJson(response, 200, { claimSlotId: issued.claimSlotId, tokenVersion: issued.tokenVersion,
            expiresAt: issued.expiresAt, replayed: true });
        } else {
          sendJson(response, 201, { ...issued, ...await renderClaimQr(issued.token) });
        }
      }
      return true;
    }
    throw new RequestError(404, 'NOT_FOUND');
  }
  return false;
}

type CollectibleProjectRoute = { merchantId: string; kind: 'list' | 'create' | 'get' | 'save' | 'publish' | 'copy' | 'unpublish' | 'delete'; projectId?: string };
function matchCollectibleProjectRoute(method: string | undefined, path: string, prefix: string): CollectibleProjectRoute | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const match = path.slice(prefix.length).match(/^([^/]+)\/collectible-projects(?:\/([^/]+)(?:\/(publish|copy|unpublish|delete))?)?$/);
  if (!match) return undefined;
  const merchantId = match[1]!; const projectId = match[2]; const action = match[3];
  if (!projectId && method === 'GET') return { merchantId, kind: 'list' };
  if (!projectId && method === 'POST') return { merchantId, kind: 'create' };
  if (projectId && !action && (method === 'GET' || method === 'PUT')) return { merchantId, projectId, kind: method === 'GET' ? 'get' : 'save' };
  if (projectId && method === 'POST' && (action === 'publish' || action === 'copy' || action === 'unpublish' || action === 'delete')) return { merchantId, projectId, kind: action };
  return undefined;
}
async function runCollectibleProjectRoute(
  projects: CollectibleProjectService, route: CollectibleProjectRoute, merchantId: string, accountId: string,
  request: IncomingMessage, response: ServerResponse,
): Promise<void> {
  const input = { merchantId, accountId };
  if (route.kind === 'list') { sendJson(response, 200, { projects: await projects.list(input) }); return; }
  const projectId = route.projectId ? decodePathParameter(route.projectId) : '';
  if (route.kind === 'get') { sendJson(response, 200, await projects.get({ ...input, projectId })); return; }
  const body = await readJson(request, false, route.kind === 'save' || route.kind === 'create' ? collectibleBodyLimit : MAX_BODY_BYTES);
  const allowed = route.kind === 'create' ? ['project'] : route.kind === 'save' ? ['expectedVersion','project']
    : route.kind === 'publish' ? ['expectedVersion','campaignId'] : ['expectedVersion'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || allowed.some(key => !(key in body))) throw new RequestError(400, 'INVALID_REQUEST');
  if (route.kind === 'create') { sendJson(response, 201, await projects.create({ ...input, project: body.project })); return; }
  const expectedVersion = requirePositiveInteger(body, 'expectedVersion');
  if (route.kind === 'save') sendJson(response, 200, await projects.save({ ...input, projectId, expectedVersion, project: body.project }));
  else if (route.kind === 'copy') sendJson(response, 201, await projects.copy({ ...input, projectId, expectedVersion }));
  else if (route.kind === 'unpublish') sendJson(response, 200, await projects.unpublish({ ...input, projectId, expectedVersion }));
  else if (route.kind === 'delete') sendJson(response, 200, await projects.remove({ ...input, projectId, expectedVersion }));
  else sendJson(response, 200, await projects.publish({ ...input, projectId, expectedVersion, campaignId: requireString(body, 'campaignId') }));
}
