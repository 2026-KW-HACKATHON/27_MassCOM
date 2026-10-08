import { isRewardMilestone } from '../badge-rules.js';
import { decodePathParameter, readConsentBody, readJson, requireString } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleAccount(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { customerIdentities, badges, consent } = deps;
  const { resolveAccountId } = runtime;
  if (request.method === 'POST' && request.url === '/customer/identity-tokens') {
    if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    sendJson(response, 201, await customerIdentities.create(accountId));
    return true;
  }

  if (request.method === 'POST' && request.url === '/customer/identity-tokens/revoke') {
    if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request);
    await customerIdentities.revoke({ accountId, token: requireString(body, 'token') });
    sendJson(response, 200, { status: 'REVOKED' });
    return true;
  }

  if (request.method === 'GET' && request.url === '/me/badges') {
    if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, await badges.getBadges(accountId));
    return true;
  }

  const openRewardMatch = request.url?.match(/^\/me\/badges\/rewards\/([^/]+)\/open$/);
  if (request.method === 'POST' && openRewardMatch) {
    if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const milestoneText = decodePathParameter(openRewardMatch[1]!);
    const milestone = Number(milestoneText);
    const body = await readJson(request, true);
    if (Object.keys(body).length > 0 || !/^[1-9]$/.test(milestoneText) || !isRewardMilestone(milestone)) {
      throw new RequestError(400, 'INVALID_REQUEST');
    }
    sendJson(response, 200, await badges.openReward({ accountId, milestone }));
    return true;
  }

  if (request.url === '/me/consent' && (request.method === 'GET' || request.method === 'POST')) {
    if (!consent) throw new RequestError(503, 'CONSENT_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    if (request.method === 'GET') {
      sendJson(response, 200, await consent.status(accountId));
    } else {
      sendJson(response, 200, await consent.record({
        accountId, source: consent.appSource, ...readConsentBody(await readJson(request)),
      }));
    }
    return true;
  }
  return false;
}
