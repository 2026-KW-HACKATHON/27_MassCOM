import { ExperienceError, type Equipment } from '../collection-experience.js';
import { decodePathParameter, readJson, requireString } from '../http/request-body.js';
import { requireBearerToken } from '../http/request-auth.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { NotificationError, type NotificationPreferences } from '../notifications.js';
import type { RouteContext } from './context.js';

export async function handleExperience(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { collectionExperience, notifications } = deps.experienceServices;
  const { resolveAccountId, requireCurrentPlayConsent, experienceWriteLimiter } = runtime;
  const friendExperienceMatch = path.match(/^\/me\/friends\/([^/]+)\/experience$/);
  if (path.startsWith('/me/experience') || friendExperienceMatch) {
    if (!collectionExperience) throw new RequestError(503, 'EXPERIENCE_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    if (path === '/me/experience' && request.method === 'GET') {
      sendJson(response, 200, await collectionExperience.getSnapshot(accountId));
    } else if (friendExperienceMatch && request.method === 'GET') {
      sendJson(response, 200, await collectionExperience.getFriend({ accountId,
        friendshipId: decodePathParameter(friendExperienceMatch[1]!) }));
    } else if ((path === '/me/experience/equipment' || path === '/me/experience/wishlist') && request.method === 'PATCH') {
      const decision = experienceWriteLimiter.consume(accountId);
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        throw new RequestError(429, 'EXPERIENCE_RATE_LIMITED');
      }
      const body = await readJson(request);
      if (path.endsWith('/wishlist')) {
        if (Object.keys(body).length !== 1 || !('itemId' in body) ||
            (body.itemId !== null && typeof body.itemId !== 'string')) throw new ExperienceError('EXPERIENCE_INVALID');
        sendJson(response, 200, await collectionExperience.setWishlist({ accountId, itemId: body.itemId as string | null }));
      } else {
        if (!Object.keys(body).length || Object.keys(body).some(key => !['badgeId','cosmetics','coinEntitlementId','coinSource'].includes(key))) {
          throw new ExperienceError('EXPERIENCE_INVALID');
        }
        sendJson(response, 200, await collectionExperience.setEquipment({ accountId,
          ...body as { badgeId?: string | null; cosmetics?: Partial<Equipment>; coinEntitlementId?: string | null;
            coinSource?: { sourceKind: 'VISIT' | 'STORE_DRAW' | 'GRADE_DRAW' | 'REROLL'; sourceId: string } | null } }));
      }
    } else throw new RequestError(404, 'NOT_FOUND');
    return true;
  }
  if (path.startsWith('/api/notifications')) {
    if (!notifications) throw new RequestError(503, 'NOTIFICATIONS_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const readMatch = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (request.method === 'GET' && path === '/api/notifications') {
      sendJson(response, 200, { items: await notifications.list(accountId), preferences: await notifications.preferences(accountId) });
    } else if (request.method === 'GET' && path === '/api/notifications/preferences') {
      sendJson(response, 200, { preferences: await notifications.preferences(accountId) });
    } else if (request.method === 'PATCH' && path === '/api/notifications/preferences') {
      await requireCurrentPlayConsent(accountId);
      const body = await readJson(request);
      if (!Object.keys(body).length || Object.keys(body).some(key =>
        !['pushEnabled','rewardAvailable','couponExpiring','campaignExpiring'].includes(key) || typeof body[key] !== 'boolean')) {
        throw new NotificationError('INVALID_NOTIFICATION');
      }
      sendJson(response, 200, { preferences: await notifications.updatePreferences(accountId, body as Partial<NotificationPreferences>) });
    } else if (path === '/api/notifications/devices' && (request.method === 'POST' || request.method === 'DELETE')) {
      if (request.method === 'POST') await requireCurrentPlayConsent(accountId);
      const body = await readJson(request);
      if (Object.keys(body).some(key => !(request.method === 'POST' ? ['deviceId','token','platform'] : ['deviceId']).includes(key))) {
        throw new NotificationError('INVALID_NOTIFICATION');
      }
      const deviceId = requireString(body, 'deviceId');
      if (request.method === 'POST') {
        if (body.platform !== 'android') throw new NotificationError('INVALID_NOTIFICATION');
        await notifications.registerDevice(accountId, deviceId, requireString(body, 'token'), body.platform, requireBearerToken(request));
      } else await notifications.unregisterDevice(accountId, deviceId, requireBearerToken(request));
      response.writeHead(204).end();
    } else if (readMatch && request.method === 'POST') {
      await notifications.markRead(accountId, decodePathParameter(readMatch[1]!));
      response.writeHead(204).end();
    } else throw new RequestError(404, 'NOT_FOUND');
    return true;
  }
  return false;
}
