import { decodePathParameter, readJson, requireEmptyBody, requireOnlyKeys, requireString } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleShowcase(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { accessRequests, claimSlots } = deps;
  const { resolveAccountId, showcaseAccessRequestLimiter, showcaseTestVisitLimiter } = runtime;
  if (request.url === '/showcase/access-requests/mine' && request.method === 'GET') {
    if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await accessRequests.mine(accountId));
    return true;
  }

  if (request.url === '/showcase/access-requests' && request.method === 'POST') {
    if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
    const accountId = await resolveAccountId(request);
    const decision = showcaseAccessRequestLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendJson(response, 429, { code: 'SHOWCASE_ACCESS_RATE_LIMITED' });
      return true;
    }
    requireEmptyBody(await readJson(request, true));
    const { created, request: view } = await accessRequests.request(accountId);
    sendJson(response, created ? 201 : 200, { request: view });
    return true;
  }

  if (request.url === '/showcase/admin/access-requests' && request.method === 'GET') {
    if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await accessRequests.listPending(accountId));
    return true;
  }

  const accessRequestDecisionMatch = request.url?.match(
    /^\/showcase\/admin\/access-requests\/([^/]+)\/(approve|reject)$/,
  );
  if (request.method === 'POST' && accessRequestDecisionMatch) {
    if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
    const accountId = await resolveAccountId(request);
    requireEmptyBody(await readJson(request, true));
    const requestId = decodePathParameter(accessRequestDecisionMatch[1]!);
    const decision = accessRequestDecisionMatch[2] === 'approve' ? 'APPROVED' : 'REJECTED';
    await accessRequests.decide(accountId, requestId, decision);
    sendJson(response, 200, { status: decision });
    return true;
  }

  // 시연 전용 "테스트 방문 만들기"(#295): 운영 API에는 경로 자체가 없다(accessRequests와 같은 showcaseDeployment 판정).
  if (request.url === '/showcase/test-visits' && request.method === 'POST') {
    if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
    if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const decision = showcaseTestVisitLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendJson(response, 429, { code: 'SHOWCASE_TEST_VISIT_RATE_LIMITED' });
      return true;
    }
    const body = await readJson(request);
    requireOnlyKeys(body, ['merchantId']);
    const merchantId = requireString(body, 'merchantId');
    const issued = await claimSlots.issueShowcaseTestSlot({ merchantId, accountId });
    const redeemed = await claimSlots.redeem({ accountId, token: issued.token });
    sendJson(response, 201, redeemed);
    return true;
  }
  return false;
}
