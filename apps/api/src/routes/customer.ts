import {
  decodePathParameter, readJson, requireEmptyBody, requireNumber, requireOnlyKeys, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { isMileageGrade } from '../mileage-rules.js';
import type { RouteContext } from './context.js';

export async function handleCustomer(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { friends, storeTickets, mileageShop, visitorFeedback, recommendations, campaignBenefits } = deps;
  const { resolveAccountId, visitorFeedbackWriteLimiter } = runtime;
  if (request.method === 'GET' && path === '/me/campaign-benefits') {
    if (!campaignBenefits) throw new RequestError(503, 'CAMPAIGN_BENEFITS_NOT_CONFIGURED');
    sendJson(response, 200, await campaignBenefits.listBenefits(await resolveAccountId(request)));
    return true;
  }
  const benefitClaim = path.match(/^\/me\/campaign-benefits\/([^/]+)\/claim$/);
  if (request.method === 'POST' && benefitClaim) {
    if (!campaignBenefits) throw new RequestError(503, 'CAMPAIGN_BENEFITS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    requireEmptyBody(await readJson(request, true));
    const result = await campaignBenefits.claimBenefit({ accountId, benefitId: decodePathParameter(benefitClaim[1]!) });
    sendJson(response, result.replayed ? 200 : 201, result);
    return true;
  }
  if (request.method === 'GET' && request.url === '/me/friends') {
    if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await friends.list(accountId));
    return true;
  }

  if (request.method === 'GET' && path === '/me/store-tickets') {
    if (!storeTickets) throw new RequestError(503, 'STORE_TICKETS_NOT_CONFIGURED');
    sendJson(response, 200, await storeTickets.list(await resolveAccountId(request)));
    return true;
  }
  const ticketOpenMatch = path.match(/^\/me\/store-tickets\/([^/]+)\/open$/);
  if (request.method === 'POST' && ticketOpenMatch) {
    if (!storeTickets) throw new RequestError(503, 'STORE_TICKETS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request, true);
    if (Object.keys(body).length) throw new RequestError(400, 'INVALID_REQUEST');
    sendJson(response, 200, await storeTickets.open({ accountId,
      entitlementId: decodePathParameter(ticketOpenMatch[1]!) }));
    return true;
  }

  if (request.method === 'POST' && request.url === '/me/friends') {
    if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    // 코드는 사람이 붙여넣은 값이라 공백·하이픈이 섞일 수 있지만 터무니없이 긴 값은 거절한다.
    const code = requireString(body, 'code');
    if (Object.keys(body).some(key => key !== 'code') || code.length > 32) {
      throw new RequestError(400, 'INVALID_REQUEST');
    }
    const added = await friends.addByCode({ accountId, code });
    sendJson(response, added.created ? 201 : 200, added);
    return true;
  }

  const friendMatch = request.url?.match(/^\/me\/friends\/([^/]+)$/);
  if (request.method === 'DELETE' && friendMatch) {
    if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await friends.remove({ accountId, friendshipId: decodePathParameter(friendMatch[1]!) });
    sendJson(response, 200, { status: 'REMOVED' });
    return true;
  }

  if (request.method === 'POST' && request.url === '/me/friend-code/rotate') {
    if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request, true);
    if (Object.keys(body).length > 0) throw new RequestError(400, 'INVALID_REQUEST');
    sendJson(response, 200, await friends.rotateCode(accountId));
    return true;
  }

  if (request.method === 'PUT' && request.url === '/me/profile') {
    if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    if (!Object.keys(body).length || Object.keys(body).some(key => key !== 'nickname' && key !== 'intro')) throw new RequestError(400, 'INVALID_REQUEST');
    const nickname = body.nickname === undefined ? undefined : requireString(body, 'nickname', true);
    const intro = body.intro === undefined ? undefined : requireString(body, 'intro', true);
    if (friends.setProfile) sendJson(response, 200, await friends.setProfile({ accountId, ...(nickname !== undefined ? { nickname } : {}), ...(intro !== undefined ? { intro } : {}) }));
    else if (nickname !== undefined && intro === undefined) sendJson(response, 200, await friends.setNickname({ accountId, nickname }));
    else throw new RequestError(503, 'PROFILE_NOT_CONFIGURED');
    return true;
  }

  if (request.method === 'GET' && request.url === '/shop') {
    if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await mileageShop.getShop(accountId));
    return true;
  }

  if (request.method === 'GET' && path === '/shop/history') {
    if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const cursor = new URL(request.url!, 'http://localhost').searchParams.get('cursor');
    sendJson(response, 200, await mileageShop.getHistory({
      accountId, ...(cursor !== null ? { cursor } : {}),
    }));
    return true;
  }

  if (request.method === 'POST' && request.url === '/shop/rerolls') {
    if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => !['grade', 'requestId', 'expectedRemaining'].includes(key))) {
      throw new RequestError(400, 'INVALID_REQUEST');
    }
    const grade = requireString(body, 'grade');
    if (!isMileageGrade(grade)) throw new RequestError(400, 'INVALID_REQUEST');
    const requestId = requireString(body, 'requestId');
    if (requestId.length > 128) throw new RequestError(400, 'INVALID_REQUEST');
    const expectedRemaining = requireNumber(body, 'expectedRemaining');
    if (expectedRemaining < 0) throw new RequestError(400, 'INVALID_REQUEST');
    const result = await mileageShop.reroll({ accountId, grade, requestId, expectedRemaining });
    sendJson(response, result.replayed ? 200 : 201, result);
    return true;
  }

  if (request.method === 'PUT' && request.url === '/shop/avatar') {
    if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== 'itemId')) throw new RequestError(400, 'INVALID_REQUEST');
    const itemId = body.itemId;
    if (itemId !== null && typeof itemId !== 'string') throw new RequestError(400, 'INVALID_REQUEST');
    sendJson(response, 200, await mileageShop.setAvatar({ accountId, itemId }));
    return true;
  }

  if (request.method === 'PUT' && request.url === '/shop/clothing') {
    if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    if (Object.keys(body).some((key) => key !== 'itemId')) throw new RequestError(400, 'INVALID_REQUEST');
    const itemId = body.itemId;
    if (itemId !== null && typeof itemId !== 'string') throw new RequestError(400, 'INVALID_REQUEST');
    sendJson(response, 200, await mileageShop.setClothing({ accountId, itemId }));
    return true;
  }

  // 방문한 가게에 남기는 특징 태그·바라는 점·짧은 의견(#334). 공개 집계는 /merchants의 visitorTags이고 바라는 점·의견은 점주에게만 간다.
  const visitorFeedbackMatch = path.match(/^\/me\/merchant-feedback\/([^/]+)$/);
  if (visitorFeedbackMatch && (request.method === 'GET' || request.method === 'PUT')) {
    if (!visitorFeedback) throw new RequestError(503, 'VISITOR_FEEDBACK_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(visitorFeedbackMatch[1]!);
    if (request.method === 'GET') {
      sendJson(response, 200, await visitorFeedback.getMine(accountId, merchantId));
      return true;
    }
    const decision = visitorFeedbackWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendJson(response, 429, { code: 'VISITOR_FEEDBACK_RATE_LIMITED' });
      return true;
    }
    const body = await readJson(request);
    requireOnlyKeys(body, ['tags', 'suggestions', 'note']);
    sendJson(response, 200, await visitorFeedback.upsert(accountId, merchantId, {
      tags: body.tags, suggestions: body.suggestions, note: body.note,
    }));
    return true;
  }

  if (request.method === 'GET' && request.url === '/recommendations') {
    if (!recommendations) {
      throw new RequestError(503, 'RECOMMENDATIONS_NOT_CONFIGURED');
    }
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, {
      recommendations: await recommendations.listRecommendations(accountId),
    });
    return true;
  }
  return false;
}
