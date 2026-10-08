import { developmentHeaderAccountResolver } from '../api-deps.js';
import {
  decodePathParameter, readJson, requireIdentityTokenBody, requirePositiveInteger, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { matchReversalRoute, runReversalRoute } from '../http/reversal-route.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleMerchantApp(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const {
    baseAccountResolver, merchantAccess, claimSlots, customerIdentities, badges, reversals, merchantOverview, visitorFeedback,
  } = deps;
  const { resolveAccountId, requireCustomerScan } = runtime;
  if (
    request.method === 'GET' &&
    /^\/merchant\/merchants\/[^/]+\/context$/.test(request.url ?? '')
  ) {
    if (!merchantAccess) {
      throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    }
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(request.url!.split('/')[3]!);
    const grant = await merchantAccess.requirePermission({
      accountId,
      merchantId,
      permission: 'VIEW_MERCHANT',
    });
    sendJson(response, 200, grant);
    return true;
  }

  if (
    request.method === 'POST' &&
    /^\/merchant\/merchants\/[^/]+\/claim-slots$/.test(request.url ?? '')
  ) {
    if (!merchantAccess) {
      throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    }
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(request.url!.split('/')[3]!);
    await merchantAccess.requirePermission({
      accountId,
      merchantId,
      permission: 'CONFIRM_VISIT',
    });
    if (!claimSlots) {
      throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
    }
    const body = await readJson(request);
    if ('customerIdentityToken' in body) {
      if (body.useConfirmed !== true || 'customerAccountId' in body) throw new RequestError(400, 'INVALID_REQUEST');
      const issued = await claimSlots.issue({ merchantId,
        customerIdentityToken: requireString(body, 'customerIdentityToken'),
        merchantReference: requireString(body, 'merchantReference'),
        createdByAccountId: accountId });
      sendJson(response, 'replayed' in issued ? 200 : 201, issued);
    } else {
      if ('useConfirmed' in body) throw new RequestError(400, 'INVALID_REQUEST');
      if (baseAccountResolver !== developmentHeaderAccountResolver) throw new RequestError(403, 'CUSTOMER_IDENTITY_REQUIRED');
      const issued = await claimSlots.issue({ merchantId,
        customerAccountId: requireString(body, 'customerAccountId'),
        merchantReference: requireString(body, 'merchantReference'),
        createdByAccountId: accountId });
      sendJson(response, 201, issued);
    }
    return true;
  }

  const identityResolveMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/customer-identities\/resolve$/);
  if (request.method === 'POST' && identityResolveMatch) {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
    const staffAccountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(identityResolveMatch[1]!);
    await requireCustomerScan(staffAccountId, merchantId);
    const body = await readJson(request);
    sendJson(response, 200, await customerIdentities.resolve({
      token: requireString(body, 'customerIdentityToken'), merchantId, staffAccountId,
    }));
    return true;
  }

  const couponLookupMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/coupons\/lookup$/);
  const couponRedeemMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/coupons\/([^/]+)\/redeem$/);
  if (request.method === 'POST' && (couponLookupMatch || couponRedeemMatch)) {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
    const staffAccountId = await resolveAccountId(request);
    const merchantId = decodePathParameter((couponLookupMatch ?? couponRedeemMatch)![1]!);
    await merchantAccess.requirePermission({ accountId: staffAccountId, merchantId, permission: 'REDEEM_COUPON' });
    const customerIdentityToken = requireIdentityTokenBody(await readJson(request));
    if (couponLookupMatch) {
      sendJson(response, 200, await badges.lookupCoupons({
        token: customerIdentityToken, merchantId, staffAccountId,
      }));
    } else {
      sendJson(response, 200, await badges.redeemCoupon({
        token: customerIdentityToken, merchantId, staffAccountId,
        couponId: decodePathParameter(couponRedeemMatch![2]!),
      }));
    }
    return true;
  }

  const mobileReversal = matchReversalRoute(request.method, path, '/merchant/merchants/');
  if (mobileReversal) {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    if (!reversals) throw new RequestError(503, 'REVERSALS_NOT_CONFIGURED');
    const staffAccountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(mobileReversal.merchantId);
    await merchantAccess.requirePermission({ accountId: staffAccountId, merchantId, permission: mobileReversal.kind === 'recent-coupons' || mobileReversal.kind === 'undo-coupon' ? 'REDEEM_COUPON' : 'CONFIRM_VISIT' });
    sendJson(response, 200, await runReversalRoute(reversals, mobileReversal, merchantId, staffAccountId, request));
    return true;
  }

  // 모바일 점주 현황(#341): 시연 점포도 활성 멤버십과 방문 확인 권한으로 조회한다.
  const mobileOverview = path.match(/^\/merchant\/merchants\/([^/]+)\/overview$/);
  if (mobileOverview && request.method === 'GET') {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    if (!merchantOverview) throw new RequestError(503, 'MERCHANT_OVERVIEW_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(mobileOverview[1]!);
    await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
    sendJson(response, 200, await merchantOverview.overview({ merchantId }));
    return true;
  }

  // 모바일 손님 의견 요약은 웹과 같은 응답을 쓰되 실제 점포 전용 목록으로 제한하지 않는다.
  const mobileVisitorFeedback = path.match(/^\/merchant\/merchants\/([^/]+)\/visitor-feedback$/);
  if (mobileVisitorFeedback && request.method === 'GET') {
    if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    if (!visitorFeedback) throw new RequestError(503, 'VISITOR_FEEDBACK_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(mobileVisitorFeedback[1]!);
    await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
    sendJson(response, 200, await visitorFeedback.merchantSummary(merchantId));
    return true;
  }

  const reissueMatch = request.url?.match(
    /^\/merchant\/merchants\/([^/]+)\/claim-slots\/([^/]+)\/reissue$/,
  );
  if (request.method === 'POST' && reissueMatch) {
    if (!merchantAccess) {
      throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
    }
    if (!claimSlots) {
      throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
    }
    const accountId = await resolveAccountId(request);
    const merchantId = decodePathParameter(reissueMatch[1]!);
    await merchantAccess.requirePermission({
      accountId,
      merchantId,
      permission: 'CONFIRM_VISIT',
    });
    const body = await readJson(request);
    const issued = await claimSlots.reissue({
      merchantId,
      claimSlotId: decodePathParameter(reissueMatch[2]!),
      expectedTokenVersion: requirePositiveInteger(body, 'expectedTokenVersion'),
      requestedByAccountId: accountId,
    });
    sendJson(response, 200, issued);
    return true;
  }
  return false;
}
